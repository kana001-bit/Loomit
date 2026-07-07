import {
  collectProjectReadinessDiagnostics,
  createCheckReport,
  loadProject,
  resolveParts,
  runChecks
} from "@loomit/core";
import { formatCheckJson } from "../formatters/checkJson.js";
import { formatCheckText } from "../formatters/checkText.js";

export type CheckOutputFormat = "text" | "json";

export interface CheckCommandOptions {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

interface ParsedCheckArgs {
  readonly help: boolean;
  readonly format: CheckOutputFormat;
  readonly startPath: string;
}

export async function runCheckCommand(
  args: readonly string[],
  options: CheckCommandOptions
): Promise<number> {
  const parsedArgs = parseCheckArgs(args, options.cwd);

  if (typeof parsedArgs === "string") {
    options.stderr(`${parsedArgs}\n\n${formatCheckHelp()}`);
    return 2;
  }

  if (parsedArgs.help) {
    options.stdout(formatCheckHelp());
    return 0;
  }

  const projectResult = await loadProject(parsedArgs.startPath);

  if (!projectResult.ok) {
    writeReport(createCheckReport({ diagnostics: projectResult.diagnostics }), parsedArgs, options);
    return 1;
  }

  const resolvedProjectResult = await resolveParts(projectResult.value);

  if (!resolvedProjectResult.ok) {
    writeReport(
      createCheckReport({ diagnostics: resolvedProjectResult.diagnostics }),
      parsedArgs,
      options
    );
    return 1;
  }

  // loom add してからでないと意味がない状況(part が空/未登録の .val)を黙って ok にせず案内する。
  const readinessDiagnostics = await collectProjectReadinessDiagnostics(resolvedProjectResult.value);
  const report = runChecks(resolvedProjectResult.value);
  const finalReport = createCheckReport({
    diagnostics: [...report.diagnostics, ...readinessDiagnostics],
    compatibility: report.compatibility
  });
  writeReport(finalReport, parsedArgs, options);

  return finalReport.status === "error" ? 1 : 0;
}

export function formatCheckHelp(): string {
  return [
    "Usage: loom check [path] [--format text|json]",
    "",
    "Validate the current Loomit project and report compatibility diagnostics.",
    "",
    "Options:",
    "  --format text|json  Output format. Defaults to text.",
    "  --help              Show this help."
  ].join("\n") + "\n";
}

function parseCheckArgs(args: readonly string[], cwd: string): ParsedCheckArgs | string {
  let format: CheckOutputFormat = "text";
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
  report: Parameters<typeof formatCheckText>[0],
  parsedArgs: ParsedCheckArgs,
  options: CheckCommandOptions
): void {
  const formatted = parsedArgs.format === "json" ? formatCheckJson(report) : formatCheckText(report);
  options.stdout(formatted);
}
