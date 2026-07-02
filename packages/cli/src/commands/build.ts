import { join, resolve } from "node:path";

import {
  buildProject,
  createBuildReport,
  loadProject,
  resolveParts,
  runChecks
} from "@loomit/core";
import { formatBuildJson } from "../formatters/buildJson.js";
import { formatBuildText } from "../formatters/buildText.js";
import type { BuildReport, LoadedProject } from "@loomit/core";

export type BuildOutputFormat = "text" | "json";

export interface BuildCommandOptions {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

interface ParsedBuildArgs {
  readonly help: boolean;
  readonly format: BuildOutputFormat;
  readonly startPath: string;
}

export async function runBuildCommand(
  args: readonly string[],
  options: BuildCommandOptions
): Promise<number> {
  const parsedArgs = parseBuildArgs(args, options.cwd);

  if (typeof parsedArgs === "string") {
    options.stderr(`${parsedArgs}\n\n${formatBuildHelp()}`);
    return 2;
  }

  if (parsedArgs.help) {
    options.stdout(formatBuildHelp());
    return 0;
  }

  const projectResult = await loadProject(parsedArgs.startPath);

  if (!projectResult.ok) {
    writeReport(createBuildErrorReport(parsedArgs.startPath, projectResult.diagnostics), parsedArgs, options);
    return 1;
  }

  const resolvedProjectResult = await resolveParts(projectResult.value);

  if (!resolvedProjectResult.ok) {
    writeReport(
      createBuildErrorReportForProject(projectResult.value, resolvedProjectResult.diagnostics),
      parsedArgs,
      options
    );
    return 1;
  }

  const checkReport = runChecks(resolvedProjectResult.value);

  if (checkReport.status === "error") {
    writeReport(
      createBuildErrorReportForProject(projectResult.value, [
        ...checkReport.diagnostics,
        ...checkReport.compatibility.flatMap((result) => result.diagnostics)
      ]),
      parsedArgs,
      options
    );
    return 1;
  }

  const buildResult = await buildProject(resolvedProjectResult.value);

  if (!buildResult.ok) {
    writeReport(
      createBuildErrorReportForProject(projectResult.value, buildResult.diagnostics),
      parsedArgs,
      options
    );
    return 1;
  }

  writeReport(buildResult.value, parsedArgs, options);
  return buildResult.value.status === "error" ? 1 : 0;
}

export function formatBuildHelp(): string {
  return [
    "Usage: loom build [path] [--format text|json]",
    "",
    "Collect referenced part files into the project output directory and write a manifest.",
    "",
    "Options:",
    "  --format text|json  Output format. Defaults to text.",
    "  --help              Show this help."
  ].join("\n") + "\n";
}

function parseBuildArgs(args: readonly string[], cwd: string): ParsedBuildArgs | string {
  let format: BuildOutputFormat = "text";
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

function createBuildErrorReport(
  startPath: string,
  diagnostics: BuildReport["diagnostics"]
): BuildReport {
  const outputDir = resolve(startPath, "output");

  return createBuildReport({
    diagnostics,
    outputDir,
    manifestFilePath: join(outputDir, "manifest.json")
  });
}

function createBuildErrorReportForProject(
  loadedProject: LoadedProject,
  diagnostics: BuildReport["diagnostics"]
): BuildReport {
  const outputDir = resolve(
    loadedProject.paths.projectRoot,
    loadedProject.project.outputs?.dir ?? "./output"
  );

  return createBuildReport({
    diagnostics,
    outputDir,
    manifestFilePath: join(outputDir, "manifest.json")
  });
}

function writeReport(
  report: BuildReport,
  parsedArgs: ParsedBuildArgs,
  options: BuildCommandOptions
): void {
  const formatted = parsedArgs.format === "json" ? formatBuildJson(report) : formatBuildText(report);
  options.stdout(formatted);
}
