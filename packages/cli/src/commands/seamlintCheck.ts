import { spawnResolvedProcess } from "./subprocess.js";

import {
  collectProjectReadinessDiagnostics,
  createDiagnostic,
  createSeamlintGeometryRequest,
  getStatusForDiagnostics,
  loadProject,
  materializeSeamlintGeometry,
  parseSeamlintGeometryReport,
  resolveParts,
  type Diagnostic,
  type ReportStatus,
  type SeamlintGeometryRequestReport
} from "@loomit/core";

import { formatSeamlintCheckJson } from "../formatters/seamlintCheckJson.js";
import { formatSeamlintCheckText } from "../formatters/seamlintCheckText.js";

export type SeamlintCheckOutputFormat = "text" | "json";

// Seamlint 実行が失敗しうる理由。string に広げず列挙するのは、これが診断コードとして report JSON に出る
// 契約値だから(語彙の正本は core の diagnostics/codes.ts)。呼び出し側の `code === "SEAMLINT_NOT_FOUND"`
// のような分岐も、綴りを間違えれば TS2367 で落ちる。
export type SeamlintRunFailureCode =
  | "SEAMLINT_NOT_FOUND"
  | "SEAMLINT_SPAWN_FAILED"
  | "SEAMLINT_BAD_OUTPUT";

// Seamlint 実行の結果。ok なら parse 済み report、失敗なら理由コード(未検出/spawn失敗/不正出力)。
export type SeamlintRunResult =
  | { readonly ok: true; readonly report: SeamlintGeometryRequestReport; readonly exitCode: number }
  | { readonly ok: false; readonly code: SeamlintRunFailureCode; readonly message: string };

// Seamlint を実際に走らせる境界。既定は subprocess アダプタだが、テストは fake を注入して
// 実 Seamlint 無しで組み立て・整形・exit code を検証する(transport 差し替え可能にする狙い)。
export interface SeamlintRunner {
  run(requestJson: string): Promise<SeamlintRunResult>;
}

// Seamlint 実行の顛末。ran=走って report を得た / skipped=測る seam が無く呼ばなかった /
// unavailable=呼べなかった(未検出など)。
export type SeamlintCheckOutcome =
  | { readonly kind: "ran"; readonly report: SeamlintGeometryRequestReport }
  | { readonly kind: "skipped"; readonly reason: string }
  | {
      readonly kind: "unavailable";
      readonly code: SeamlintRunFailureCode;
      readonly message: string;
    };

export interface SeamlintCheckReport {
  readonly status: ReportStatus;
  readonly partsCount: number;
  readonly checksCount: number;
  readonly diagnostics: readonly Diagnostic[];
  readonly seamlint: SeamlintCheckOutcome;
}

export interface SeamlintCheckCommandOptions {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  // 注入用。未指定なら subprocess アダプタ(既定 bin=slnt)を使う。
  readonly runner?: SeamlintRunner;
}

interface ParsedSeamlintCheckArgs {
  readonly help: boolean;
  readonly format: SeamlintCheckOutputFormat;
  readonly startPath: string;
  readonly slntBin: string | undefined;
}

export async function runSeamlintCheckCommand(
  args: readonly string[],
  options: SeamlintCheckCommandOptions
): Promise<number> {
  const parsedArgs = parseSeamlintCheckArgs(args, options.cwd);

  if (typeof parsedArgs === "string") {
    options.stderr(`${parsedArgs}\n\n${formatSeamlintCheckHelp()}`);
    return 2;
  }

  if (parsedArgs.help) {
    options.stdout(formatSeamlintCheckHelp());
    return 0;
  }

  const projectResult = await loadProject(parsedArgs.startPath);
  if (!projectResult.ok) {
    return writeReport(errorReport(projectResult.diagnostics), parsedArgs, options);
  }

  const resolvedProjectResult = await resolveParts(projectResult.value);
  if (!resolvedProjectResult.ok) {
    return writeReport(errorReport(resolvedProjectResult.diagnostics), parsedArgs, options);
  }

  // check / slnt request と同じ readiness を通し、loom add 前の空 project を黙って ok にしない。
  const readinessDiagnostics = await collectProjectReadinessDiagnostics(resolvedProjectResult.value);
  const built = createSeamlintGeometryRequest(resolvedProjectResult.value);
  const diagnostics: Diagnostic[] = [...built.diagnostics, ...readinessDiagnostics];

  // 測る seam が1つも無いなら Seamlint は呼ばない(空 request を投げても無意味)。
  if (built.request.checks.length === 0) {
    return writeReport(
      {
        status: getStatusForDiagnostics(diagnostics),
        partsCount: built.request.parts.length,
        checksCount: 0,
        diagnostics,
        seamlint: { kind: "skipped", reason: "no seams to measure" }
      },
      parsedArgs,
      options
    );
  }

  // subprocess で相手に filesystem を触らせないため、geometry 本文を request に inline してから渡す。
  const materialized = await materializeSeamlintGeometry(built.request);
  diagnostics.push(...materialized.diagnostics);

  const runner =
    options.runner ??
    createSubprocessSeamlintRunner({ bin: resolveSlntBin(parsedArgs.slntBin), cwd: options.cwd });
  const runResult = await runner.run(JSON.stringify(materialized.request));

  if (!runResult.ok) {
    diagnostics.push(runnerErrorDiagnostic(runResult));
    return writeReport(
      {
        status: "error",
        partsCount: built.request.parts.length,
        checksCount: built.request.checks.length,
        diagnostics,
        seamlint: { kind: "unavailable", code: runResult.code, message: runResult.message }
      },
      parsedArgs,
      options
    );
  }

  const status = worstStatus(getStatusForDiagnostics(diagnostics), runResult.report.status);
  return writeReport(
    {
      status,
      partsCount: built.request.parts.length,
      checksCount: built.request.checks.length,
      diagnostics,
      seamlint: { kind: "ran", report: runResult.report }
    },
    parsedArgs,
    options
  );
}

// bin=slnt を subprocess で呼び、request JSON を stdin で渡して stdout の GeometryRequestReport を parse する。
// 未検出や不正出力は理由コード付きの失敗にして、呼び出し側が degrade できるようにする。
export function createSubprocessSeamlintRunner(options: {
  readonly bin: string;
  // 実行ファイル解決・子プロセスの基準ディレクトリ。CLI 全体と揃えるため runCli の cwd を渡す
  // (未指定なら process.cwd())。相対 --slnt やカレント上の slnt.cmd の解決が他コマンドと一致する。
  readonly cwd?: string;
}): SeamlintRunner {
  const cwd = options.cwd ?? process.cwd();
  return {
    run(requestJson: string): Promise<SeamlintRunResult> {
      return new Promise<SeamlintRunResult>((resolvePromise) => {
        // Windows は cmd.exe の未検出メッセージが locale 依存かつ OEM 符号化で信頼できないので、
        // PATH/PATHEXT を自前で辿って実行ファイルを解決し、見つからなければ subprocess を起動せず
        // 未検出を確定する(posix は shell 無し spawn の ENOENT で拾う)。
        const child = spawnResolvedProcess(options.bin, ["check-request", "--json"], cwd);
        if (child === undefined) {
          resolvePromise({
            ok: false,
            code: "SEAMLINT_NOT_FOUND",
            message: `Could not find Seamlint executable "${options.bin}".`
          });
          return;
        }

        let stdout = "";
        let stderr = "";
        let settled = false;
        const settle = (result: SeamlintRunResult): void => {
          if (!settled) {
            settled = true;
            resolvePromise(result);
          }
        };

        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
        });

        child.on("error", (error: NodeJS.ErrnoException) => {
          settle({
            ok: false,
            code: error.code === "ENOENT" ? "SEAMLINT_NOT_FOUND" : "SEAMLINT_SPAWN_FAILED",
            message: error.message
          });
        });

        child.on("close", (exitCode) => {
          const report = parseSeamlintGeometryReport(stdout);
          if (report === undefined) {
            // 実行ファイルは解決済み(存在は確定)なので、report を返せない=Seamlint 側の失敗。
            // 未検出には振り分けず、stderr を添えて素通しし、本当の入力不正を隠さない。
            settle({
              ok: false,
              code: "SEAMLINT_BAD_OUTPUT",
              message: `Seamlint did not return a valid geometry report (exit ${exitCode ?? "null"}).${stderr.trim() ? ` ${stderr.trim()}` : ""}`
            });
            return;
          }
          settle({ ok: true, report, exitCode: exitCode ?? 0 });
        });

        // 相手が読む前に閉じても EPIPE で落とさない。
        child.stdin.on("error", () => {});
        child.stdin.write(requestJson);
        child.stdin.end();
      });
    }
  };
}

export function formatSeamlintCheckHelp(): string {
  return [
    "Usage: loom slnt check [path] [--slnt <path>] [--format text|json]",
    "",
    "Build a Seamlint geometry request for the project and run Seamlint to measure the seams.",
    "",
    "Options:",
    "  --slnt <path>       Seamlint executable to run. Defaults to LOOMIT_SLNT or \"slnt\" on PATH.",
    "  --format text|json  Output format. Defaults to text.",
    "  --help              Show this help."
  ].join("\n") + "\n";
}

// slnt 実行ファイルの解決。明示 --slnt > LOOMIT_SLNT 環境変数 > PATH 上の "slnt"。loom match も同じ
// 解決規則で Seamlint を呼ぶため export する。
export function resolveSlntBin(flagValue: string | undefined): string {
  return flagValue ?? process.env.LOOMIT_SLNT ?? "slnt";
}

// 実行ファイル解決・引用は subprocess.ts に共通化した(Truer runner と同じ規則を使うため)。既存の import
// 元(テスト含む)を変えずに済むよう、seamlintCheck からも従来どおり再 export する。
export { quoteForCmd, resolveExecutable } from "./subprocess.js";

function runnerErrorDiagnostic(runResult: {
  readonly code: SeamlintRunFailureCode;
  readonly message: string;
}): Diagnostic {
  const notFound = runResult.code === "SEAMLINT_NOT_FOUND";
  // Diagnostic を直接組み立てず createDiagnostic を通す。Loomit 本体の発行口をここに揃えることで、
  // 未登録コード(X_ 拡張コード)を本体から出せないという型の保証が、この関数にも効く。
  return createDiagnostic({
    severity: "error",
    code: runResult.code,
    message: notFound
      ? `Loomit could not find the Seamlint executable to run the geometry check (${runResult.message}).`
      : `Loomit could not run Seamlint for the geometry check: ${runResult.message}`,
    target: "seamlint",
    suggestion: notFound
      ? ["Install Seamlint so \"slnt\" is on PATH, or pass --slnt <path> to point at the executable."]
      : ["Check that the Seamlint executable runs and accepts \"slnt check-request --json\"."]
  });
}

const statusRank: Record<ReportStatus, number> = { ok: 0, warning: 1, error: 2 };

function worstStatus(left: ReportStatus, right: ReportStatus): ReportStatus {
  return statusRank[right] > statusRank[left] ? right : left;
}

function errorReport(diagnostics: readonly Diagnostic[]): SeamlintCheckReport {
  return {
    status: "error",
    partsCount: 0,
    checksCount: 0,
    diagnostics,
    seamlint: { kind: "skipped", reason: "project did not load" }
  };
}

function writeReport(
  report: SeamlintCheckReport,
  parsedArgs: ParsedSeamlintCheckArgs,
  options: SeamlintCheckCommandOptions
): number {
  options.stdout(
    parsedArgs.format === "json" ? formatSeamlintCheckJson(report) : formatSeamlintCheckText(report)
  );
  return report.status === "error" ? 1 : 0;
}

function parseSeamlintCheckArgs(
  args: readonly string[],
  cwd: string
): ParsedSeamlintCheckArgs | string {
  let format: SeamlintCheckOutputFormat = "text";
  let help = false;
  let slntBin: string | undefined;
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

    if (arg?.startsWith("--") === true) {
      return `Unknown option: ${arg}`;
    }

    if (arg !== undefined) {
      positional.push(arg);
    }
  }

  if (positional.length > 1) {
    return "Expected at most one project path.";
  }

  return {
    help,
    format,
    startPath: positional[0] ?? cwd,
    slntBin
  };
}
