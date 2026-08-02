import {
  createDiagnostic,
  diffParts,
  diffValSources,
  getErrno,
  loadProject,
  loadProjectedPartWithSource,
  loadPrototypeNotesFile,
  type Diagnostic,
  type ProjectedPartSource,
  type PrototypeNotes,
  type ValSourceDiffSummary
} from "@loomit/core";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";

import { formatDiffJson } from "../formatters/diffJson.js";
import { formatDiffText } from "../formatters/diffText.js";
import {
  resolveGitRepoRoot,
  resolveProjectPrefix,
  resolveRef,
  withRefWorktree
} from "../git/gitRevision.js";

export type DiffOutputFormat = "text" | "json";

export interface DiffCommandOptions {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

// diff の入力は3系統: 既存のパス指定(part 2つ / project 2つ + --part)、Git revision range(A..B)、
// 単一 revision(その版 ↔ 作業ツリー)。後者2つは project 差分なので --part を必須にする。
type ParsedDiffArgs =
  | {
      readonly kind: "paths";
      readonly format: DiffOutputFormat;
      readonly fromPath: string;
      readonly toPath: string;
      readonly partRole?: string;
    }
  | {
      readonly kind: "refRange";
      readonly format: DiffOutputFormat;
      readonly fromRef: string;
      readonly toRef: string;
      readonly partRole: string;
    }
  | {
      readonly kind: "refWorktree";
      readonly format: DiffOutputFormat;
      readonly ref: string;
      readonly partRole: string;
    };

interface ResolvedDiffPaths {
  readonly fromPath: string;
  readonly toPath: string;
  // 各辺の project root。loadProjectedPartWithSource は files.source を project root 相対優先で解決するので、
  // 既に project を読んでいる経路(--part / revision)ではその root をそのまま渡し、part.loom から
  // loomit.yml を探して登り直させない。パス指定モード(project を読まない)では undefined。
  readonly fromProjectRoot?: string;
  readonly toProjectRoot?: string;
  readonly prototypeNotes?: PrototypeNotes;
  readonly notesDiagnostics: readonly Diagnostic[];
}

export async function runDiffCommand(
  args: readonly string[],
  options: DiffCommandOptions
): Promise<number> {
  const parsedArgs = parseDiffArgs(args, options.cwd);

  if (typeof parsedArgs === "string") {
    options.stderr(`${parsedArgs}\n\n${formatDiffHelp()}`);
    return 2;
  }

  if (parsedArgs.kind === "help") {
    options.stdout(formatDiffHelp());
    return 0;
  }

  if (parsedArgs.kind === "paths") {
    return runPathDiff(parsedArgs, options);
  }

  return runRefDiff(parsedArgs, options);
}

async function runPathDiff(
  parsedArgs: Extract<ParsedDiffArgs, { kind: "paths" }>,
  options: DiffCommandOptions
): Promise<number> {
  if (parsedArgs.partRole !== undefined) {
    return diffProjectPart(parsedArgs.fromPath, parsedArgs.toPath, parsedArgs.partRole, parsedArgs, options);
  }

  return diffResolvedParts(
    { fromPath: parsedArgs.fromPath, toPath: parsedArgs.toPath, notesDiagnostics: [] },
    parsedArgs,
    options
  );
}

async function runRefDiff(
  parsedArgs: Extract<ParsedDiffArgs, { kind: "refRange" | "refWorktree" }>,
  options: DiffCommandOptions
): Promise<number> {
  const repo = await resolveGitRepoRoot(options.cwd);
  if (!repo.ok) {
    if (repo.reason === "git-unavailable") {
      // git 自体を起動できなかった。「repo 外」ではなく「git が無い」と告げて正しい直し方に向ける。
      options.stderr(
        `Git was not found — loom diff <revision> needs Git on PATH${repo.message ? ` (${repo.message})` : ""}.\n`
      );
      return 1;
    }
    // git は走ったが拒否した(repo 外 / dubious ownership / 権限 等)。git 自身の文面をそのまま見せて
    // 実際の直し方に向ける(canned な「repo 内で実行しろ」で誤誘導しない。文字列マッチは locale 依存なので避ける)。
    options.stderr(`Could not use Git in ${options.cwd}: ${repo.message}\n\n${formatDiffHelp()}`);
    return 2;
  }
  const repoRoot = repo.repoRoot;

  // 対象の一着は cwd 側とみなし、repo root からの相対位置を各 worktree に投影する。位置は自前で
  // 引き算せず git に訊く(理由は resolveProjectPrefix のコメント: 表記の食い違いで「差分なし」と
  // 嘘をつく経路を消すため)。
  const prefix = await resolveProjectPrefix(options.cwd);
  if (!prefix.ok) {
    options.stderr(
      `Could not locate ${options.cwd} inside the Git repository: ${prefix.message}\n\n${formatDiffHelp()}`
    );
    return 2;
  }
  const projectRelPath = prefix.prefix;

  // revision は worktree を作る前に解決し、返った SHA をそのまま worktree に使う。symbolic ref
  // (HEAD/branch)を後段で解決し直すと、間に ref が動いたとき検証した版と別の commit を diff しうる
  // (TOCTOU)。SHA は不変なので、検証した版をそのまま固定できる。
  if (parsedArgs.kind === "refRange") {
    const fromSha = await resolveRef(repoRoot, parsedArgs.fromRef);
    if (fromSha === undefined) {
      return notARevision(parsedArgs.fromRef, options);
    }
    const toSha = await resolveRef(repoRoot, parsedArgs.toRef);
    if (toSha === undefined) {
      return notARevision(parsedArgs.toRef, options);
    }

    try {
      return await withRefWorktree(repoRoot, fromSha, (fromWorktree) =>
        withRefWorktree(repoRoot, toSha, (toWorktree) =>
          diffProjectPart(
            join(fromWorktree, projectRelPath),
            join(toWorktree, projectRelPath),
            parsedArgs.partRole,
            parsedArgs,
            options
          )
        )
      );
    } catch (error) {
      return refDiffError(error, options);
    }
  }

  // 単一 ref: 解決済み SHA を from、作業ツリー(cwd)を to にして「その版から何を変えたか」を出す。
  const refSha = await resolveRef(repoRoot, parsedArgs.ref);
  if (refSha === undefined) {
    return notARevision(parsedArgs.ref, options);
  }

  try {
    return await withRefWorktree(repoRoot, refSha, (refWorktree) =>
      diffProjectPart(join(refWorktree, projectRelPath), options.cwd, parsedArgs.partRole, parsedArgs, options)
    );
  } catch (error) {
    return refDiffError(error, options);
  }
}

function notARevision(ref: string, options: DiffCommandOptions): number {
  options.stderr(`Not a Git revision: ${ref}.\n\n${formatDiffHelp()}`);
  return 2;
}

function refDiffError(error: unknown, options: DiffCommandOptions): number {
  options.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
  return 1;
}

async function diffProjectPart(
  fromProjectPath: string,
  toProjectPath: string,
  partRole: string,
  parsedArgs: ParsedDiffArgs,
  options: DiffCommandOptions
): Promise<number> {
  const pathResult = await resolveProjectPartPaths(fromProjectPath, toProjectPath, partRole);

  if (!pathResult.ok) {
    writeReport(
      createPartLoadFailureReport(fromProjectPath, toProjectPath, pathResult.diagnostics),
      parsedArgs,
      options
    );
    return 1;
  }

  return diffResolvedParts(pathResult.value, parsedArgs, options);
}

async function diffResolvedParts(
  value: ResolvedDiffPaths,
  parsedArgs: ParsedDiffArgs,
  options: DiffCommandOptions
): Promise<number> {
  const fromResult = await loadProjectedPartWithSource(
    value.fromPath,
    value.fromProjectRoot === undefined ? undefined : { projectRoot: value.fromProjectRoot }
  );

  if (!fromResult.ok) {
    writeReport(
      createPartLoadFailureReport(value.fromPath, value.toPath, fromResult.diagnostics),
      parsedArgs,
      options
    );
    return 1;
  }

  const toResult = await loadProjectedPartWithSource(
    value.toPath,
    value.toProjectRoot === undefined ? undefined : { projectRoot: value.toProjectRoot }
  );

  if (!toResult.ok) {
    writeReport(
      createPartLoadFailureReport(value.fromPath, value.toPath, toResult.diagnostics),
      parsedArgs,
      options
    );
    return 1;
  }

  // 前段で出た診断を diff レポートに載せて status にも反映する:
  // notes の読み込み失敗(壊れている/読めない)と、darts 射影(source.val が読めない・未対応形状)。
  const inputDiagnostics = [
    ...value.notesDiagnostics,
    ...fromResult.diagnostics,
    ...toResult.diagnostics
  ];

  // 射影に出ないもの(製図式・増分・型紙輪郭の構成)が動いたかは Part からは分からないので、両版の .val 本文を
  // ここで比べる。片側にしか .val が無ければ added / removed、両方無い・読めない側があるなら語らない(undefined)。
  const draftingSource = summarizeDraftingSource(fromResult.value.source, toResult.value.source);

  const report = diffParts(fromResult.value.part, toResult.value.part, {
    ...(value.prototypeNotes === undefined ? {} : { prototypeNotes: value.prototypeNotes }),
    ...(inputDiagnostics.length === 0 ? {} : { inputDiagnostics }),
    ...(draftingSource === undefined ? {} : { draftingSource })
  });
  writeReport(report, parsedArgs, options);

  return report.status === "error" ? 1 : 0;
}

// 両版の .val から製図構造の差分を要約する。
//
// **読めなかった側があるときは何も言わない。** 「読めない」は「無い」ではないので、片側が unreadable のときに
// 「製図ソースが外れた = removed」と報告すると、読み取り失敗の warning と同時に「.val が片側に無い」と誤報する
// ことになる(実際にはこちらは何も知らない)。読めなかった事実は PART_SOURCE_VAL_READ_FAILED が既に伝えている
// ので、こちらは黙る。
//
// 片側だけに .val が**在る**(もう片側は absent)なら added / removed。製図の中身は比べようがない。
function summarizeDraftingSource(
  fromSource: ProjectedPartSource | undefined,
  toSource: ProjectedPartSource | undefined
): ValSourceDiffSummary | undefined {
  if (fromSource?.status === "unreadable" || toSource?.status === "unreadable") {
    return undefined;
  }

  if (fromSource?.status === "read" && toSource?.status === "read") {
    return diffValSources(fromSource.text, toSource.text);
  }

  // 片側にしか .val が無い。**「製図が動いた」とは別の status** にする ── 片側が未コミットなだけ(ENOENT=正常系で
  // 診断も出ない)のときに「製図が動いた」と同じ文面を出すと、作者は動いていない製図を疑いに行く。
  if (toSource?.status === "read") {
    return { status: "added" };
  }

  if (fromSource?.status === "read") {
    return { status: "removed" };
  }

  return undefined;
}

export function formatDiffHelp(): string {
  return [
    "Usage: loom diff <from-part.loom> <to-part.loom> [--format text|json]",
    "       loom diff <from-project> <to-project> --part <role> [--format text|json]",
    "       loom diff <from-rev>..<to-rev> --part <role> [--format text|json]",
    "       loom diff <rev> --part <role> [--format text|json]",
    "",
    "Compare two Loomit parts and show semantic feature changes.",
    "Each Git revision is a snapshot of the project; the revision forms compare snapshots",
    "across Git history (run inside the repo). <rev> on its own compares that snapshot",
    "against the working tree.",
    "",
    "Options:",
    "  --part <role>       Compare the same project part role (required for revision diffs).",
    "  --format text|json  Output format. Defaults to text.",
    "  --help              Show this help."
  ].join("\n") + "\n";
}

function parseDiffArgs(
  args: readonly string[],
  cwd: string
): ParsedDiffArgs | { readonly kind: "help" } | string {
  let format: DiffOutputFormat = "text";
  let help = false;
  let partRole: string | undefined;
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (arg === "--format") {
      const value = args[index + 1];

      if (value !== "text" && value !== "json") {
        return "Expected --format to be followed by text or json.";
      }

      format = value;
      index += 1;
      continue;
    }

    if (arg === "--part") {
      const value = args[index + 1];

      if (value === undefined || value.startsWith("--")) {
        return "Expected --part to be followed by a project part role such as sleeve.";
      }

      partRole = value;
      index += 1;
      continue;
    }

    if (arg?.startsWith("--") === true) {
      return `Unknown option: ${arg}`;
    }

    if (arg !== undefined) {
      // Git revision と path を区別するため、ここでは resolve せず生のまま貯める。
      positional.push(arg);
    }
  }

  // --help は位置引数の検証より先に確定させる。他コマンドと同様、loom diff --help をヘルプ表示にする。
  if (help) {
    return { kind: "help" };
  }

  // A..B: 単一の位置引数に ".." が含まれていれば Git revision range として読む。
  if (positional.length === 1 && positional[0] !== undefined && positional[0].includes("..")) {
    const raw = positional[0];
    const separator = raw.indexOf("..");
    const fromRef = raw.slice(0, separator);
    const toRef = raw.slice(separator + 2);

    if (fromRef.length === 0 || toRef.length === 0) {
      return "Expected a Git revision range like main..HEAD.";
    }

    if (partRole === undefined) {
      return "A Git-revision diff needs --part <role> (for example: loom diff main..HEAD --part body).";
    }

    return { kind: "refRange", format, fromRef, toRef, partRole };
  }

  // 単一の位置引数(".." 無し): その revision と作業ツリーを比べる。
  if (positional.length === 1 && positional[0] !== undefined) {
    if (partRole === undefined) {
      return "Pass two part files, or <revision> --part <role> to diff a revision against the working tree.";
    }

    return { kind: "refWorktree", format, ref: positional[0], partRole };
  }

  // 2 つの位置引数: 従来どおりのパス指定(part file 2つ、または project 2つ + --part)。
  if (positional.length === 2) {
    return {
      kind: "paths",
      format,
      ...(partRole === undefined ? {} : { partRole }),
      fromPath: resolve(cwd, positional[0] ?? ""),
      toPath: resolve(cwd, positional[1] ?? "")
    };
  }

  return "Expected two part file paths, or a Git revision (main..HEAD or <revision>) with --part <role>.";
}

async function resolveProjectPartPaths(
  fromProjectPath: string,
  toProjectPath: string,
  partRole: string
): Promise<
  | {
      readonly ok: true;
      // 形が drift しないよう ResolvedDiffPaths をそのまま使う(以前はここに同じ形を重複定義していた)。
      readonly value: ResolvedDiffPaths;
    }
  | {
      readonly ok: false;
      // 形が drift しないよう core の Diagnostic をそのまま使う(以前はここに同じ形を重複定義していた)。
      readonly diagnostics: readonly Diagnostic[];
    }
> {
  // diff --part に渡すプロジェクトパスは実在必須にする。存在しないと findProjectRoot が上位ディレクトリへ
  // 遡ってしまい、タイプミスが親側の別プロジェクトに化けて「差分なし」と誤判定される。先に弾く。
  // ここで climb を防ぐのが目的なので、権限拒否等の非 ENOENT も loadProject には流さない。ただし
  // loadOptionalPrototypeNotes と同様に ENOENT(実在しない)と読めない(権限等)は別の診断に分ける。
  const blockedProjectPaths = (
    await Promise.all(
      [fromProjectPath, toProjectPath].map(async (projectPath) => ({
        projectPath,
        access: await checkProjectPathAccess(projectPath)
      }))
    )
  ).filter((entry) => entry.access !== "ok");

  if (blockedProjectPaths.length > 0) {
    return {
      ok: false,
      diagnostics: blockedProjectPaths.map((entry) =>
        entry.access === "missing"
          ? createDiagnostic({
              severity: "error",
              code: "PROJECT_PATH_NOT_FOUND",
              message: `project のパスが存在しません: ${entry.projectPath} / Project path does not exist: ${entry.projectPath}.`,
              target: entry.projectPath,
              suggestion: [
                "Pass an existing Loomit project directory for each side of the diff."
              ]
            })
          : createDiagnostic({
              severity: "error",
              code: "PROJECT_PATH_ACCESS_FAILED",
              message: `project のパスにアクセスできませんでした: ${entry.projectPath} / Could not access project path: ${entry.projectPath}.`,
              target: entry.projectPath,
              suggestion: ["Check read permissions for the project directory."]
            })
      )
    };
  }

  const fromProjectResult = await loadProject(fromProjectPath);

  if (!fromProjectResult.ok) {
    return {
      ok: false,
      diagnostics: fromProjectResult.diagnostics
    };
  }

  const toProjectResult = await loadProject(toProjectPath);

  if (!toProjectResult.ok) {
    return {
      ok: false,
      diagnostics: toProjectResult.diagnostics
    };
  }

  const fromPartPath = fromProjectResult.value.paths.partFilePaths[partRole];
  const toPartPath = toProjectResult.value.paths.partFilePaths[partRole];

  if (fromPartPath === undefined || toPartPath === undefined) {
    return {
      ok: false,
      diagnostics: [
        ...(fromPartPath === undefined
          ? [
              createDiagnostic({
                severity: "error",
                code: "PROJECT_PART_ROLE_NOT_FOUND",
                message: `project に part role "${partRole}" が定義されていません。 / Project does not define part role "${partRole}".`,
                target: fromProjectResult.value.paths.projectFilePath,
                suggestion: [`Add parts.${partRole}, or choose an existing project role.`]
              })
            ]
          : []),
        ...(toPartPath === undefined
          ? [
              createDiagnostic({
                severity: "error",
                code: "PROJECT_PART_ROLE_NOT_FOUND",
                message: `project に part role "${partRole}" が定義されていません。 / Project does not define part role "${partRole}".`,
                target: toProjectResult.value.paths.projectFilePath,
                suggestion: [`Add parts.${partRole}, or choose an existing project role.`]
              })
            ]
          : [])
      ]
    };
  }

  const fromNotes = await loadOptionalPrototypeNotes(
    join(fromProjectResult.value.paths.projectRoot, "notes/prototype-notes.yml")
  );
  const toNotes = await loadOptionalPrototypeNotes(
    join(toProjectResult.value.paths.projectRoot, "notes/prototype-notes.yml")
  );

  const prototypeNotes = mergePrototypeNotes(fromNotes.notes, toNotes.notes);
  const notesDiagnostics = [...fromNotes.diagnostics, ...toNotes.diagnostics];

  return {
    ok: true,
    value: {
      fromPath: fromPartPath,
      toPath: toPartPath,
      fromProjectRoot: fromProjectResult.value.paths.projectRoot,
      toProjectRoot: toProjectResult.value.paths.projectRoot,
      notesDiagnostics,
      ...(prototypeNotes === undefined ? {} : { prototypeNotes })
    }
  };
}

// "ok" = 実在, "missing" = ENOENT(タイポ等), "error" = 権限拒否など存在判定できない失敗。
async function checkProjectPathAccess(
  candidate: string
): Promise<"ok" | "missing" | "error"> {
  try {
    await access(candidate);
    return "ok";
  } catch (error) {
    return getErrno(error) === "ENOENT" ? "missing" : "error";
  }
}

async function loadOptionalPrototypeNotes(
  filePath: string
): Promise<{ readonly notes?: PrototypeNotes; readonly diagnostics: readonly Diagnostic[] }> {
  // 既定パスに notes が無いのは正常系(notes は任意)。silent に空で返す。
  try {
    await access(filePath);
  } catch (error) {
    if (getErrno(error) === "ENOENT") {
      return { diagnostics: [] };
    }
  }

  // ファイルが在るのに壊れている/読めない場合は握りつぶさず診断を返す(loom test / suggest-tests と揃える)。
  const result = await loadPrototypeNotesFile(filePath);

  if (!result.ok) {
    return { diagnostics: result.diagnostics };
  }

  return { notes: result.value, diagnostics: result.diagnostics };
}

function mergePrototypeNotes(
  ...sources: readonly (PrototypeNotes | undefined)[]
): PrototypeNotes | undefined {
  const noteMap = new Map<string, PrototypeNotes["notes"][number]>();

  for (const source of sources) {
    if (source === undefined) {
      continue;
    }

    for (const note of source.notes) {
      noteMap.set(note.id, note);
    }
  }

  if (noteMap.size === 0) {
    return undefined;
  }

  return {
    schema: "loomit.prototype_notes.v0",
    notes: [...noteMap.values()]
  };
}

function createPartLoadFailureReport(
  fromPath: string,
  toPath: string,
  // 形が drift しないよう core の Diagnostic をそのまま使う(以前はここに同じ形を重複定義していた)。
  diagnostics: readonly Diagnostic[]
): Parameters<typeof formatDiffText>[0] {
  return {
    status: "error",
    // 読み込み失敗時は判断シグナルを立てられないので、すべて中立(none)にする。
    decisionSummary: {
      silhouetteImpact: "none",
      volumeChange: "none",
      connectionRisk: "none",
      prototypeNoteSignal: "none"
    },
    recheckHints: {
      partRole: {
        from: "unknown",
        to: "unknown",
        changed: false
      },
      connectors: [],
      requirements: []
    },
    diagnostics,
    from: {
      name: fromPath,
      variant: "unknown",
      type: "unknown"
    },
    to: {
      name: toPath,
      variant: "unknown",
      type: "unknown"
    },
    changes: [],
    relatedNotes: []
  };
}

function writeReport(
  report: Parameters<typeof formatDiffText>[0],
  parsedArgs: ParsedDiffArgs,
  options: DiffCommandOptions
): void {
  const formatted = parsedArgs.format === "json" ? formatDiffJson(report) : formatDiffText(report);
  options.stdout(formatted);
}
