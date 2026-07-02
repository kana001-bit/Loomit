import {
  createCheckReport,
  createDoctorReport,
  loadProject,
  resolveParts,
  runChecks
} from "@loomit/core";
import { formatDoctorJson } from "../formatters/doctorJson.js";
import { formatDoctorText } from "../formatters/doctorText.js";

export type DoctorOutputFormat = "text" | "json";

export interface DoctorCommandOptions {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

interface ParsedDoctorArgs {
  readonly help: boolean;
  readonly format: DoctorOutputFormat;
  readonly startPath: string;
}

export async function runDoctorCommand(
  args: readonly string[],
  options: DoctorCommandOptions
): Promise<number> {
  const parsedArgs = parseDoctorArgs(args, options.cwd);

  if (typeof parsedArgs === "string") {
    options.stderr(`${parsedArgs}\n\n${formatDoctorHelp()}`);
    return 2;
  }

  if (parsedArgs.help) {
    options.stdout(formatDoctorHelp());
    return 0;
  }

  const projectResult = await loadProject(parsedArgs.startPath);

  if (!projectResult.ok) {
    const report = createDoctorReport(createCheckReport({ diagnostics: projectResult.diagnostics }));
    writeReport(report, parsedArgs, options);
    return 1;
  }

  const resolvedProjectResult = await resolveParts(projectResult.value);

  if (!resolvedProjectResult.ok) {
    const report = createDoctorReport(
      createCheckReport({ diagnostics: resolvedProjectResult.diagnostics })
    );
    writeReport(report, parsedArgs, options);
    return 1;
  }

  const report = createDoctorReport(runChecks(resolvedProjectResult.value));
  writeReport(report, parsedArgs, options);

  return report.status === "error" ? 1 : 0;
}

export function formatDoctorHelp(): string {
  return [
    "Usage: loom doctor [path] [--format text|json]",
    "",
    "Explain Loomit project diagnostics in more detail than check.",
    "",
    "Options:",
    "  --format text|json  Output format. Defaults to text.",
    "  --help              Show this help."
  ].join("\n") + "\n";
}

function parseDoctorArgs(args: readonly string[], cwd: string): ParsedDoctorArgs | string {
  let format: DoctorOutputFormat = "text";
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
  report: Parameters<typeof formatDoctorText>[0],
  parsedArgs: ParsedDoctorArgs,
  options: DoctorCommandOptions
): void {
  const formatted =
    parsedArgs.format === "json" ? formatDoctorJson(report) : formatDoctorText(report);
  options.stdout(formatted);
}
