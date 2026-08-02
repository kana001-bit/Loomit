import {
  buildPairSeamRequest,
  createDiagnostic,
  getStatusForDiagnostics,
  loadProject,
  materializeSeamlintGeometry,
  resolveParts,
  type Diagnostic,
  type ReportStatus
} from "@loomit/core";

import { formatMatchJson } from "../formatters/matchJson.js";
import { formatMatchText } from "../formatters/matchText.js";
import {
  createSubprocessSeamlintRunner,
  resolveSlntBin,
  type SeamlintCheckOutcome,
  type SeamlintRunFailureCode,
  type SeamlintRunner
} from "./seamlintCheck.js";
import {
  resolveTruerBin,
  runTruerPropose,
  type TruerProposeOutcome,
  type TruerRunner
} from "./truerPropose.js";

export type MatchOutputFormat = "text" | "json";

// loom match の結果。roleA/roleB を pair として測り、seamCount(両者を繋ぐ縫い目の数)と Seamlint の顛末を返す。
// --reference 指定時は Truer に直し方を提案させ、reference(固定側)と truer の顛末も載せる。
export interface MatchReport {
  readonly status: ReportStatus;
  readonly roleA: string;
  readonly roleB: string;
  readonly reference?: string;
  readonly seamCount: number;
  readonly diagnostics: readonly Diagnostic[];
  readonly seamlint: SeamlintCheckOutcome;
  readonly truer?: TruerProposeOutcome;
}

export interface MatchCommandOptions {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  // 注入用。未指定なら subprocess アダプタ(既定 bin=slnt)で Seamlint を呼ぶ。テストは fake を渡す。
  readonly runner?: SeamlintRunner;
  // Truer 注入用(--reference 時)。未指定なら subprocess アダプタ(既定 bin=tru)。テストは fake を渡す。
  readonly truerRunner?: TruerRunner;
}

interface ParsedMatchArgs {
  readonly help: boolean;
  readonly format: MatchOutputFormat;
  readonly startPath: string;
  readonly roleA: string;
  readonly roleB: string;
  readonly slntBin: string | undefined;
  // 固定辺とみなす側の role(a か b)。未指定なら測定のみで Truer は呼ばない。
  readonly reference: string | undefined;
  readonly truBin: string | undefined;
}

// loom match <a> <b>: 2パーツの縫い目を pair 単位で測る。プロジェクト全体を測る loom slnt check と違い、
// 名指しした2パーツを繋ぐ縫い目**だけ**に request を絞ってから Seamlint に渡す。ずれの直し方提案(Truer spawn)は
// 次スライス ── ここは「front と back は合っているか」を測って見せるところまで。
export async function runMatchCommand(
  args: readonly string[],
  options: MatchCommandOptions
): Promise<number> {
  const parsedArgs = parseMatchArgs(args, options.cwd);

  if (typeof parsedArgs === "string") {
    options.stderr(`${parsedArgs}\n\n${formatMatchHelp()}`);
    return 2;
  }

  if (parsedArgs.help) {
    options.stdout(formatMatchHelp());
    return 0;
  }

  // 縫い目は異なるパーツ同士を繋ぐ(connect と同じ規律)。同じ role どうしの match は弾く。
  // 「2つまで」ではない ── 1本の縫い目に3パーツ以上が参加することはある(band seam 等)。match が一度に
  // 測るのが pair、というだけ。
  if (parsedArgs.roleA === parsedArgs.roleB) {
    return writeReport(
      earlyErrorReport(parsedArgs, [
        createDiagnostic({
          severity: "error",
          code: "MATCH_SAME_ROLE",
          message: `同じパーツ "${parsedArgs.roleA}" 同士は match できません。縫い目は異なるパーツ同士を繋ぎます。 / Cannot match part "${parsedArgs.roleA}" to itself; a seam joins parts to each other, not a part to itself.`,
          target: parsedArgs.roleA,
          suggestion: ["異なる2つの part role を渡してください。 / Give two distinct part roles."]
        })
      ]),
      parsedArgs,
      options
    );
  }

  const projectResult = await loadProject(parsedArgs.startPath);
  if (!projectResult.ok) {
    return writeReport(earlyErrorReport(parsedArgs, projectResult.diagnostics), parsedArgs, options);
  }

  const resolvedProjectResult = await resolveParts(projectResult.value);
  if (!resolvedProjectResult.ok) {
    return writeReport(
      earlyErrorReport(parsedArgs, resolvedProjectResult.diagnostics),
      parsedArgs,
      options
    );
  }

  const resolvedProject = resolvedProjectResult.value;

  // 名指しした role が登録パーツに無いなら、そもそも測れない。両方まとめて確認し、欠けている分を1診断に列挙する
  // (片方だけ直してもう一度落ちる往復を避ける)。「未接続(縫い目が無い)」とは別の失敗として区別する。
  const missingRoles = [parsedArgs.roleA, parsedArgs.roleB].filter(
    (role) => resolvedProject.parts[role] === undefined
  );
  if (missingRoles.length > 0) {
    return writeReport(
      earlyErrorReport(parsedArgs, [
        createDiagnostic({
          severity: "error",
          code: "MATCH_ROLE_NOT_FOUND",
          message: `role ${missingRoles.map((role) => `"${role}"`).join(" / ")} のパーツが登録されていません。 / No part is registered for role ${missingRoles.map((role) => `"${role}"`).join(" / ")}.`,
          target: missingRoles.join(", "),
          suggestion: [
            "role の綴りを確認するか、loom add で先にパーツを足してください。登録済みパーツは loom check で確認できます。 / Check the role spelling, or add the part first with loom add."
          ]
        })
      ]),
      parsedArgs,
      options
    );
  }

  // loom match は pair-local。プロジェクト全体の readiness や無関係 connector の診断は持ち込まず、この2パーツが
  // 縫い合う縫い目だけを対象にした request と診断を作る(project 全体の健全性は loom check の役割)。
  const pair = buildPairSeamRequest(resolvedProject, parsedArgs.roleA, parsedArgs.roleB);
  const diagnostics: Diagnostic[] = [...pair.diagnostics];

  // 2パーツを繋ぐ connector が1つも無い = 本当に未接続。ここでだけ MATCH_NO_SEAM を出して loom connect を促す。
  if (!pair.linked) {
    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: "MATCH_NO_SEAM",
        message: `"${parsedArgs.roleA}" と "${parsedArgs.roleB}" は縫い合うと宣言されていません。 / "${parsedArgs.roleA}" and "${parsedArgs.roleB}" are not declared to sew together.`,
        target: `${parsedArgs.roleA}/${parsedArgs.roleB}`,
        suggestion: [
          `loom connect ${parsedArgs.roleA} ${parsedArgs.roleB} --as <id> で縫い合うと宣言してください。 / Declare the seam with loom connect ${parsedArgs.roleA} ${parsedArgs.roleB} --as <id>.`
        ]
      })
    );
    return writeReport(
      {
        status: getStatusForDiagnostics(diagnostics),
        roleA: parsedArgs.roleA,
        roleB: parsedArgs.roleB,
        seamCount: 0,
        diagnostics,
        seamlint: { kind: "skipped", reason: "the two parts are not declared to sew together" }
      },
      parsedArgs,
      options
    );
  }

  // 繋がってはいるが測れる check を組めなかった(path_ref 欠落 / defer / 側の宣言不完全 …)。理由は pair.diagnostics に
  // 既に載っている。未接続(MATCH_NO_SEAM)とは区別し、その診断のまま「測れなかった」と返す(Seamlint は呼ばない)。
  if (pair.request.checks.length === 0) {
    return writeReport(
      {
        status: getStatusForDiagnostics(diagnostics),
        roleA: parsedArgs.roleA,
        roleB: parsedArgs.roleB,
        seamCount: 0,
        diagnostics,
        seamlint: { kind: "skipped", reason: "seam declared but could not be measured (see diagnostics)" }
      },
      parsedArgs,
      options
    );
  }

  // subprocess で相手に filesystem を触らせないため、geometry 本文を request に inline してから渡す。
  const materialized = await materializeSeamlintGeometry(pair.request);
  diagnostics.push(...materialized.diagnostics);

  // slnt は loom 自身の測定だけでなく Truer も内部で呼ぶ(preview の edge 解決)。両者が同じ実行ファイルを
  // 使うよう一度だけ解決し、Truer にも --slnt で転送する(でないと Truer が PATH の slnt を探して落ちる)。
  const slntBin = resolveSlntBin(parsedArgs.slntBin);
  const runner =
    options.runner ?? createSubprocessSeamlintRunner({ bin: slntBin, cwd: options.cwd });
  const runResult = await runner.run(JSON.stringify(materialized.request));

  if (!runResult.ok) {
    diagnostics.push(seamlintRunnerErrorDiagnostic(runResult));
    return writeReport(
      {
        status: "error",
        roleA: parsedArgs.roleA,
        roleB: parsedArgs.roleB,
        seamCount: pair.request.checks.length,
        diagnostics,
        seamlint: { kind: "unavailable", code: runResult.code, message: runResult.message }
      },
      parsedArgs,
      options
    );
  }

  // --reference が指定されていれば、測定済み report を Truer に渡して直し方(proposal)を提案させる。
  // follower = reference でない側 = Truer が DXF を書き換える対象。DXF が無い等で呼べなければ理由を診断で示す。
  let truer: TruerProposeOutcome | undefined;
  if (parsedArgs.reference !== undefined) {
    const followerRole =
      parsedArgs.reference === parsedArgs.roleA ? parsedArgs.roleB : parsedArgs.roleA;
    const proposeResult = await runTruerPropose({
      resolvedProject,
      request: pair.request,
      report: runResult.report,
      referenceRole: parsedArgs.reference,
      followerRole,
      roleA: parsedArgs.roleA,
      roleB: parsedArgs.roleB,
      cwd: options.cwd,
      bin: resolveTruerBin(parsedArgs.truBin),
      slntBin,
      ...(options.truerRunner === undefined ? {} : { runner: options.truerRunner })
    });
    truer = proposeResult.outcome;
    diagnostics.push(...proposeResult.diagnostics);
  }

  const status = worstStatus(getStatusForDiagnostics(diagnostics), runResult.report.status);
  return writeReport(
    {
      status,
      roleA: parsedArgs.roleA,
      roleB: parsedArgs.roleB,
      ...(parsedArgs.reference === undefined ? {} : { reference: parsedArgs.reference }),
      seamCount: pair.request.checks.length,
      diagnostics,
      seamlint: { kind: "ran", report: runResult.report },
      ...(truer === undefined ? {} : { truer })
    },
    parsedArgs,
    options
  );
}

export function formatMatchHelp(): string {
  return (
    [
      "Usage: loom match <partA> <partB> [--reference <part>] [options]",
      "",
      "Measure the seam(s) that join two parts and report whether they match in",
      "length. Only the seams between the two named parts are measured (not the whole",
      "project). Which edge is the shared seam is found by Seamlint from the geometry.",
      "",
      "With --reference <part> (one of the two parts), the measured report is handed",
      "to Truer to propose how to adjust the other part to the reference length. The",
      "proposal is advisory (preview-only) and written under output/match/.",
      "",
      "Options:",
      "  --reference <part>  Fix this part's edge and propose adjusting the other to it",
      "                      (must be one of the two named parts). Runs Truer.",
      "  --slnt <path>       Seamlint executable to run. Defaults to LOOMIT_SLNT or \"slnt\" on PATH.",
      "  --tru <path>        Truer executable to run. Defaults to LOOMIT_TRU or \"tru\" on PATH.",
      "  --format text|json  Output format. Defaults to text.",
      "  --help              Show this help.",
      "",
      "Examples:",
      "  loom match front back",
      "  loom match front back --reference back"
    ].join("\n") + "\n"
  );
}

// 早期失敗(引数不正でない parse 後の失敗: 同一 role / project 未ロード / role 不明)の共通レポート。
// Seamlint は呼ばないので skipped 扱い。
function earlyErrorReport(
  parsedArgs: ParsedMatchArgs,
  diagnostics: readonly Diagnostic[]
): MatchReport {
  return {
    status: "error",
    roleA: parsedArgs.roleA,
    roleB: parsedArgs.roleB,
    seamCount: 0,
    diagnostics,
    seamlint: { kind: "skipped", reason: "did not reach measurement" }
  };
}

function seamlintRunnerErrorDiagnostic(runResult: {
  readonly code: SeamlintRunFailureCode;
  readonly message: string;
}): Diagnostic {
  const notFound = runResult.code === "SEAMLINT_NOT_FOUND";
  return createDiagnostic({
    severity: "error",
    code: runResult.code,
    // 詳細は日英併記を閉じたあとに1回だけ(両側に差し込むと stderr 全文が2回出る)。
    message: notFound
      ? `Seamlint 実行ファイルが見つからず、縫い目を測れませんでした。 / Loomit could not find the Seamlint executable to measure the seam. (${runResult.message})`
      : `Seamlint を実行できませんでした。 / Loomit could not run Seamlint. (${runResult.message})`,
    target: "seamlint",
    suggestion: notFound
      ? ["\"slnt\" を PATH に置くか、--slnt <path> で実行ファイルを指定してください。 / Install Seamlint on PATH, or pass --slnt <path>."]
      : ["Seamlint が \"slnt check-request --json\" を受け付けて動くか確認してください。 / Check that Seamlint runs and accepts \"slnt check-request --json\"."]
  });
}

const statusRank: Record<ReportStatus, number> = { ok: 0, warning: 1, error: 2 };

function worstStatus(left: ReportStatus, right: ReportStatus): ReportStatus {
  return statusRank[right] > statusRank[left] ? right : left;
}

function writeReport(
  report: MatchReport,
  parsedArgs: ParsedMatchArgs,
  options: MatchCommandOptions
): number {
  options.stdout(
    parsedArgs.format === "json" ? formatMatchJson(report) : formatMatchText(report)
  );
  return report.status === "error" ? 1 : 0;
}

function parseMatchArgs(args: readonly string[], cwd: string): ParsedMatchArgs | string {
  let format: MatchOutputFormat = "text";
  let help = false;
  let slntBin: string | undefined;
  let truBin: string | undefined;
  let reference: string | undefined;
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

    if (arg === "--slnt") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return "Expected --slnt to be followed by an executable path.";
      }
      slntBin = value;
      index += 1;
      continue;
    }

    if (arg === "--tru") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return "Expected --tru to be followed by an executable path.";
      }
      truBin = value;
      index += 1;
      continue;
    }

    if (arg === "--reference") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return "Expected --reference to be followed by a part role.";
      }
      reference = value;
      index += 1;
      continue;
    }

    if (arg?.startsWith("--") === true) {
      return `Unknown option: ${arg}`;
    }

    if (arg !== undefined) {
      positional.push(arg);
    }
  }

  if (help) {
    // --help は role より優先(引数不足でも help は出す)。startPath/role はダミーで埋める。
    return { help: true, format, startPath: cwd, roleA: "", roleB: "", slntBin, truBin, reference };
  }

  if (positional.length !== 2) {
    return "Expected exactly two part roles: loom match <partA> <partB>.";
  }

  const roleA = positional[0];
  const roleB = positional[1];
  if (roleA === undefined || roleB === undefined) {
    return "Expected exactly two part roles: loom match <partA> <partB>.";
  }

  // --reference は「どちらを固定側とみなすか」なので、名指しした2パーツのどちらかでなければならない。
  if (reference !== undefined && reference !== roleA && reference !== roleB) {
    return `Expected --reference to be one of the two parts (${roleA} or ${roleB}).`;
  }

  return { help, format, startPath: cwd, roleA, roleB, slntBin, truBin, reference };
}
