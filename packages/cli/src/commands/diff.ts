import {
  createDiagnostic,
  diffParts,
  getErrno,
  loadProject,
  loadProjectedPart,
  loadPrototypeNotesFile,
  type Diagnostic,
  type PrototypeNotes
} from "@loomit/core";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { join } from "node:path";

import { formatDiffJson } from "../formatters/diffJson.js";
import { formatDiffText } from "../formatters/diffText.js";

export type DiffOutputFormat = "text" | "json";

export interface DiffCommandOptions {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

interface ParsedDiffArgs {
  readonly help: boolean;
  readonly format: DiffOutputFormat;
  readonly fromPath: string;
  readonly toPath: string;
  readonly partRole?: string;
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

  if (parsedArgs.help) {
    options.stdout(formatDiffHelp());
    return 0;
  }

  const pathResult =
    parsedArgs.partRole === undefined
      ? {
          ok: true as const,
          value: {
            fromPath: parsedArgs.fromPath,
            toPath: parsedArgs.toPath,
            prototypeNotes: undefined,
            notesDiagnostics: [] as readonly Diagnostic[]
          }
        }
      : await resolveProjectPartPaths(parsedArgs.fromPath, parsedArgs.toPath, parsedArgs.partRole);

  if (!pathResult.ok) {
    writeReport(
      createPartLoadFailureReport(parsedArgs.fromPath, parsedArgs.toPath, pathResult.diagnostics),
      parsedArgs,
      options
    );
    return 1;
  }

  const fromResult = await loadProjectedPart(pathResult.value.fromPath);

  if (!fromResult.ok) {
    writeReport(
      createPartLoadFailureReport(pathResult.value.fromPath, pathResult.value.toPath, fromResult.diagnostics),
      parsedArgs,
      options
    );
    return 1;
  }

  const toResult = await loadProjectedPart(pathResult.value.toPath);

  if (!toResult.ok) {
    writeReport(
      createPartLoadFailureReport(pathResult.value.fromPath, pathResult.value.toPath, toResult.diagnostics),
      parsedArgs,
      options
    );
    return 1;
  }

  // 前段で出た診断を diff レポートに載せて status にも反映する:
  // notes の読み込み失敗(壊れている/読めない)と、darts 射影(source.val が読めない・未対応形状)。
  const inputDiagnostics = [
    ...pathResult.value.notesDiagnostics,
    ...fromResult.diagnostics,
    ...toResult.diagnostics
  ];

  const report = diffParts(fromResult.value, toResult.value, {
    ...(pathResult.value.prototypeNotes === undefined
      ? {}
      : { prototypeNotes: pathResult.value.prototypeNotes }),
    ...(inputDiagnostics.length === 0 ? {} : { inputDiagnostics })
  });
  writeReport(report, parsedArgs, options);

  return report.status === "error" ? 1 : 0;
}

export function formatDiffHelp(): string {
  return [
    "Usage: loom diff <from-part.loom> <to-part.loom> [--format text|json]",
    "       loom diff <from-project> <to-project> --part <role> [--format text|json]",
    "",
    "Compare two Loomit part files and show semantic feature changes.",
    "",
    "Options:",
    "  --part <role>       Compare the same project part role across two projects.",
    "  --format text|json  Output format. Defaults to text.",
    "  --help              Show this help."
  ].join("\n") + "\n";
}

function parseDiffArgs(args: readonly string[], cwd: string): ParsedDiffArgs | string {
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
      positional.push(resolve(cwd, arg));
    }
  }

  // --help は位置引数の検証より先に確定させる。他コマンドと同様、loom diff --help をヘルプ表示にする。
  if (!help && positional.length !== 2) {
    return "Expected exactly two part file paths.";
  }

  return {
    help,
    format,
    ...(partRole === undefined ? {} : { partRole }),
    fromPath: positional[0] ?? "",
    toPath: positional[1] ?? ""
  };
}

async function resolveProjectPartPaths(
  fromProjectPath: string,
  toProjectPath: string,
  partRole: string
): Promise<
  | {
      readonly ok: true;
      readonly value: {
        readonly fromPath: string;
        readonly toPath: string;
        readonly prototypeNotes?: PrototypeNotes;
        readonly notesDiagnostics: readonly Diagnostic[];
      };
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly {
        readonly severity: "info" | "warning" | "error";
        readonly code: string;
        readonly message: string;
        readonly target?: string;
        readonly suggestion?: readonly string[];
      }[];
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
              message: `Project path does not exist: ${entry.projectPath}.`,
              target: entry.projectPath,
              suggestion: [
                "Pass an existing Loomit project directory for each side of the diff."
              ]
            })
          : createDiagnostic({
              severity: "error",
              code: "PROJECT_PATH_ACCESS_FAILED",
              message: `Could not access project path: ${entry.projectPath}.`,
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
                message: `Project does not define part role "${partRole}".`,
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
                message: `Project does not define part role "${partRole}".`,
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
  diagnostics: readonly {
    readonly severity: "info" | "warning" | "error";
    readonly code: string;
    readonly message: string;
    readonly target?: string;
    readonly suggestion?: readonly string[];
  }[]
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
