import {
  collectProjectReadinessDiagnostics,
  createSeamlintGeometryRequest,
  getStatusForDiagnostics,
  loadProject,
  resolveParts,
  type Diagnostic,
  type ReportStatus,
  type SeamlintGeometryCheckRequest
} from "@loomit/core";

import { formatSeamlintRequestJson } from "../formatters/seamlintRequestJson.js";
import { formatSeamlintRequestText } from "../formatters/seamlintRequestText.js";

export type SeamlintRequestOutputFormat = "text" | "json";

export interface SeamlintRequestCommandOptions {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

export interface SeamlintRequestReport {
  readonly status: ReportStatus;
  readonly diagnostics: readonly Diagnostic[];
  readonly request: SeamlintGeometryCheckRequest;
}

interface ParsedSeamlintRequestArgs {
  readonly help: boolean;
  readonly format: SeamlintRequestOutputFormat;
  readonly startPath: string;
}

export async function runSeamlintRequestCommand(
  args: readonly string[],
  options: SeamlintRequestCommandOptions
): Promise<number> {
  const parsedArgs = parseSeamlintRequestArgs(args, options.cwd);

  if (typeof parsedArgs === "string") {
    options.stderr(`${parsedArgs}\n\n${formatSeamlintRequestHelp()}`);
    return 2;
  }

  if (parsedArgs.help) {
    options.stdout(formatSeamlintRequestHelp());
    return 0;
  }

  const projectResult = await loadProject(parsedArgs.startPath);

  if (!projectResult.ok) {
    writeReport(
      {
        status: "error",
        diagnostics: projectResult.diagnostics,
        request: {
          parts: [],
          checks: []
        }
      },
      parsedArgs,
      options
    );
    return 1;
  }

  const resolvedProjectResult = await resolveParts(projectResult.value);

  if (!resolvedProjectResult.ok) {
    writeReport(
      {
        status: "error",
        diagnostics: resolvedProjectResult.diagnostics,
        request: {
          projectRoot: projectResult.value.paths.projectRoot,
          parts: [],
          checks: []
        }
      },
      parsedArgs,
      options
    );
    return 1;
  }

  // loom add してからでないと意味がない状況(part が空/未登録の .val)を黙って ok にせず案内する。
  // check / build と同じ readiness を通し、slnt request 単独でも同じ signal を返す。
  const readinessDiagnostics = await collectProjectReadinessDiagnostics(resolvedProjectResult.value);
  const result = createSeamlintGeometryRequest(resolvedProjectResult.value);
  const diagnostics = [...result.diagnostics, ...readinessDiagnostics];
  const report: SeamlintRequestReport = {
    status: getStatusForDiagnostics(diagnostics),
    diagnostics,
    request: result.request
  };
  writeReport(report, parsedArgs, options);

  return report.status === "error" ? 1 : 0;
}

export function formatSeamlintRequestHelp(): string {
  return [
    "Usage: loom slnt request [path] [--format text|json]",
    "",
    "Build a Loomit-to-Seamlint geometry request from the current project.",
    "",
    "Options:",
    "  --format text|json  Output format. Defaults to text.",
    "  --help              Show this help."
  ].join("\n") + "\n";
}

function parseSeamlintRequestArgs(
  args: readonly string[],
  cwd: string
): ParsedSeamlintRequestArgs | string {
  let format: SeamlintRequestOutputFormat = "text";
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
  report: SeamlintRequestReport,
  parsedArgs: ParsedSeamlintRequestArgs,
  options: SeamlintRequestCommandOptions
): void {
  const formatted =
    parsedArgs.format === "json"
      ? formatSeamlintRequestJson(report)
      : formatSeamlintRequestText(report);
  options.stdout(formatted);
}
