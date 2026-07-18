import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { statSync } from "node:fs";
import { delimiter, extname, isAbsolute, join, resolve } from "node:path";

import {
  collectProjectReadinessDiagnostics,
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

// Seamlint 実行の結果。ok なら parse 済み report、失敗なら理由コード(未検出/spawn失敗/不正出力)。
export type SeamlintRunResult =
  | { readonly ok: true; readonly report: SeamlintGeometryRequestReport; readonly exitCode: number }
  | { readonly ok: false; readonly code: string; readonly message: string };

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
  | { readonly kind: "unavailable"; readonly code: string; readonly message: string };

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
        const child = spawnSeamlint(options.bin, cwd);
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

// Windows の shell コマンド文字列に実行ファイルパスを載せる際、cmd.exe のメタ文字
// (空白/& ( ) ^ < > | 等)でパスが分解されないよう常に二重引用符で囲う。二重引用符内では
// これらは字義通り扱われる。Windows のパスは " を含められないので引用符のエスケープは不要。
// (% / ! の変数展開だけは引用符内でも残るが、これは cmd.exe 固有の制約で本ケースの対象外。)
// 既に前後を引用済みの入力は二重掛けしない。
export function quoteForCmd(bin: string): string {
  if (bin.length >= 2 && bin.startsWith('"') && bin.endsWith('"')) {
    return bin;
  }
  return `"${bin}"`;
}

// Seamlint 子プロセスを起動する。cwd は実行ファイル解決・子プロセスの基準ディレクトリ。
// Windows で実行ファイルを解決できなければ undefined(未検出)。
function spawnSeamlint(bin: string, cwd: string): ChildProcessWithoutNullStreams | undefined {
  const args = ["check-request", "--json"];

  // posix は shell 無しで PATH 解決でき、未検出は ENOENT の error イベントで確実に拾える。
  if (process.platform !== "win32") {
    return spawn(bin, args, { cwd });
  }

  // Windows は .cmd/.exe を CreateProcess で直接叩けないため PATH/PATHEXT を自前解決する。
  const resolved = resolveExecutable(bin, cwd);
  if (resolved === undefined) {
    return undefined;
  }

  // 実 .exe/.com は shell 無しで直接起動でき、パス中のメタ文字に一切影響されない。
  const ext = extname(resolved).toLowerCase();
  if (ext === ".exe" || ext === ".com") {
    return spawn(resolved, args, { cwd });
  }

  // .cmd/.bat 等は cmd.exe 経由が要る。パスを二重引用符で囲みメタ文字での分解を防ぐ。固定引数のみで
  // requestJson は stdin 経由なので injection 面も安全(shell:true + args 配列の DEP0190 も踏まない)。
  return spawn(`${quoteForCmd(resolved)} ${args.join(" ")}`, { shell: true, cwd });
}

// PATH / PATHEXT を辿って実行ファイルの実体パスを返す。見つからなければ undefined。cmd.exe の
// locale 依存・OEM 符号化な未検出メッセージに頼らず、未検出を確実に判定するために使う。
// 相対パスの解決とカレントディレクトリ探索は、CLI 全体と揃えるため cwd を基準にする(process.cwd()
// ではない)ため、runCli 埋め込みで cwd を差し替えても他コマンドと挙動が一致する。
export function resolveExecutable(bin: string, cwd: string): string | undefined {
  const isWindows = process.platform === "win32";
  const hasSeparator = bin.includes("/") || (isWindows && bin.includes("\\"));

  const candidates: string[] = [];
  if (isAbsolute(bin) || hasSeparator) {
    // パス指定は PATH 探索せず、cwd 基準で解決する(絶対パスはそのまま)。
    candidates.push(resolve(cwd, bin));
  } else {
    const pathDirs = (process.env.PATH ?? "").split(delimiter).filter((dir) => dir.length > 0);
    // Windows は cmd.exe 同様まずカレントディレクトリ(= cwd)も見る。
    if (isWindows) {
      pathDirs.unshift(cwd);
    }
    for (const dir of pathDirs) {
      candidates.push(join(dir, bin));
    }
  }

  const pathExts = isWindows
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter((ext) => ext.length > 0)
    : [];

  for (const candidate of candidates) {
    // Windows で拡張子が無い名前は、cmd.exe と同様に PATHEXT を補って解決する
    // (拡張子無しの実体は CreateProcess/cmd では起動対象にならないため)。
    if (isWindows && extname(candidate) === "") {
      for (const ext of pathExts) {
        if (isFile(candidate + ext)) {
          return candidate + ext;
        }
      }
      continue;
    }
    if (isFile(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function runnerErrorDiagnostic(runResult: { readonly code: string; readonly message: string }): Diagnostic {
  const notFound = runResult.code === "SEAMLINT_NOT_FOUND";
  return {
    severity: "error",
    code: runResult.code,
    message: notFound
      ? `Loomit could not find the Seamlint executable to run the geometry check (${runResult.message}).`
      : `Loomit could not run Seamlint for the geometry check: ${runResult.message}`,
    target: "seamlint",
    suggestion: notFound
      ? ["Install Seamlint so \"slnt\" is on PATH, or pass --slnt <path> to point at the executable."]
      : ["Check that the Seamlint executable runs and accepts \"slnt check-request --json\"."]
  };
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
