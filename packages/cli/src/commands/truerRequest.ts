import {
  assembleConstraintPayload,
  collectProjectReadinessDiagnostics,
  getStatusForDiagnostics,
  loadProject,
  readValSource,
  resolveParts,
  type ConstraintPayload,
  type ConstraintPayloadPart,
  type Diagnostic,
  type ReportStatus,
  type ResolvedProject
} from "@loomit/core";

import { formatTruerRequestJson } from "../formatters/truerRequestJson.js";
import { formatTruerRequestText } from "../formatters/truerRequestText.js";

export type TruerRequestOutputFormat = "text" | "json";

export interface TruerRequestCommandOptions {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

export interface TruerRequestReport {
  readonly status: ReportStatus;
  readonly diagnostics: readonly Diagnostic[];
  readonly payload: ConstraintPayload;
}

interface ParsedTruerRequestArgs {
  readonly help: boolean;
  readonly format: TruerRequestOutputFormat;
  readonly startPath: string;
}

// 空 payload(版付き schema 付き・params/parts/connectors は空)。project が読めない等、payload を組む前に失敗した
// ときの封筒に載せる。schema id を単一ソース(core)から取るため空入力の assemble を使う(error 封筒でも版で弾ける)。
const EMPTY_PAYLOAD: ConstraintPayload = assembleConstraintPayload([]).payload;

export async function runTruerRequestCommand(
  args: readonly string[],
  options: TruerRequestCommandOptions
): Promise<number> {
  const parsedArgs = parseTruerRequestArgs(args, options.cwd);

  if (typeof parsedArgs === "string") {
    options.stderr(`${parsedArgs}\n\n${formatTruerRequestHelp()}`);
    return 2;
  }

  if (parsedArgs.help) {
    options.stdout(formatTruerRequestHelp());
    return 0;
  }

  const projectResult = await loadProject(parsedArgs.startPath);

  if (!projectResult.ok) {
    writeReport(
      { status: "error", diagnostics: projectResult.diagnostics, payload: EMPTY_PAYLOAD },
      parsedArgs,
      options
    );
    return 1;
  }

  const resolvedProjectResult = await resolveParts(projectResult.value);

  if (!resolvedProjectResult.ok) {
    writeReport(
      { status: "error", diagnostics: resolvedProjectResult.diagnostics, payload: EMPTY_PAYLOAD },
      parsedArgs,
      options
    );
    return 1;
  }

  // loom add してからでないと意味がない状況(part が空/未登録の .val)を黙って ok にせず案内する。
  // slnt request と同じ readiness を通し、truer request 単独でも同じ signal を返す。
  const readinessDiagnostics = await collectProjectReadinessDiagnostics(resolvedProjectResult.value);
  const payloadInput = await collectPayloadParts(resolvedProjectResult.value);
  const assembled = assembleConstraintPayload(payloadInput.parts);
  const diagnostics = [...payloadInput.diagnostics, ...assembled.diagnostics, ...readinessDiagnostics];
  const report: TruerRequestReport = {
    status: getStatusForDiagnostics(diagnostics),
    diagnostics,
    payload: assembled.payload
  };
  writeReport(report, parsedArgs, options);

  return report.status === "error" ? 1 : 0;
}

interface CollectedPayloadParts {
  readonly parts: readonly ConstraintPayloadPart[];
  readonly diagnostics: readonly Diagnostic[];
}

// 各 part の files.source(.val) を読んで assembleConstraintPayload の入力に整える。ドメインロジックは持たず、
// core の readValSource / assembleConstraintPayload に委ねる(CLI は薄い adapter)。
// files.source / files.piece の無い part は payload に載せられないので黙って除く(connector が無い part も core 側で除かれる)。
async function collectPayloadParts(project: ResolvedProject): Promise<CollectedPayloadParts> {
  const parts: ConstraintPayloadPart[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const resolved of Object.values(project.parts)) {
    const sourceRelativePath = resolved.part.files?.source;
    const piece = resolved.part.files?.piece;

    if (sourceRelativePath === undefined || piece === undefined) {
      continue;
    }

    const sourceResult = await readValSource(
      resolved.filePath,
      sourceRelativePath,
      project.paths.projectRoot
    );
    diagnostics.push(...sourceResult.diagnostics);

    if (sourceResult.source === undefined) {
      continue;
    }

    parts.push({
      role: resolved.role,
      piece,
      source: sourceResult.source,
      connectorIds: Object.keys(resolved.part.connectors ?? {})
    });
  }

  return { parts, diagnostics };
}

export function formatTruerRequestHelp(): string {
  return [
    "Usage: loom truer request [path] [--format text|json]",
    "",
    "Build a Loomit-to-Truer constraint payload from the current project.",
    "",
    "Options:",
    "  --format text|json  Output format. Defaults to text.",
    "  --help              Show this help."
  ].join("\n") + "\n";
}

function parseTruerRequestArgs(
  args: readonly string[],
  cwd: string
): ParsedTruerRequestArgs | string {
  let format: TruerRequestOutputFormat = "text";
  let help = false;
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
    startPath: positional[0] ?? cwd
  };
}

function writeReport(
  report: TruerRequestReport,
  parsedArgs: ParsedTruerRequestArgs,
  options: TruerRequestCommandOptions
): void {
  const formatted =
    parsedArgs.format === "json"
      ? formatTruerRequestJson(report)
      : formatTruerRequestText(report);
  options.stdout(formatted);
}
