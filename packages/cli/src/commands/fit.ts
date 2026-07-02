import { extname, isAbsolute, resolve } from "node:path";

import {
  createFitReport,
  loadProfileFile,
  loadProject,
  resolveParts,
  runFit
} from "@loomit/core";
import { formatFitJson } from "../formatters/fitJson.js";
import { formatFitText } from "../formatters/fitText.js";
import type { LoadedProject } from "@loomit/core";

export type FitOutputFormat = "text" | "json";

export interface FitCommandOptions {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

interface ParsedFitArgs {
  readonly help: boolean;
  readonly format: FitOutputFormat;
  readonly profile: string;
  readonly startPath: string;
}

export async function runFitCommand(
  args: readonly string[],
  options: FitCommandOptions
): Promise<number> {
  const parsedArgs = parseFitArgs(args, options.cwd);

  if (typeof parsedArgs === "string") {
    options.stderr(`${parsedArgs}\n\n${formatFitHelp()}`);
    return 2;
  }

  if (parsedArgs.help) {
    options.stdout(formatFitHelp());
    return 0;
  }

  const projectResult = await loadProject(parsedArgs.startPath);

  if (!projectResult.ok) {
    writeReport(createFitReport({ diagnostics: projectResult.diagnostics }), parsedArgs, options);
    return 1;
  }

  const resolvedProjectResult = await resolveParts(projectResult.value);

  if (!resolvedProjectResult.ok) {
    writeReport(
      createFitReport({ diagnostics: resolvedProjectResult.diagnostics }),
      parsedArgs,
      options
    );
    return 1;
  }

  const profilePath = resolveProfilePath(parsedArgs.profile, projectResult.value, options.cwd);
  const profileResult = await loadProfileFile(profilePath);

  if (!profileResult.ok) {
    writeReport(createFitReport({ diagnostics: profileResult.diagnostics }), parsedArgs, options);
    return 1;
  }

  const report = runFit(resolvedProjectResult.value, profileResult.value);
  writeReport(report, parsedArgs, options);

  return report.status === "error" ? 1 : 0;
}

export function formatFitHelp(): string {
  return [
    "Usage: loom fit [path] --profile <name|path> [--format text|json]",
    "",
    "Compare a Loomit project against a body profile and report fit risk.",
    "",
    "Options:",
    "  --profile name|path  Profile name from loomit.yml/profiles, or a profile file path.",
    "  --format text|json   Output format. Defaults to text.",
    "  --help               Show this help."
  ].join("\n") + "\n";
}

function parseFitArgs(args: readonly string[], cwd: string): ParsedFitArgs | string {
  let format: FitOutputFormat = "text";
  let help = false;
  let profile: string | undefined;
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

    if (arg === "--profile") {
      const value = args[index + 1];

      if (value === undefined || value.startsWith("--")) {
        return "Expected --profile to be followed by a profile name or path.";
      }

      profile = value;
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
    return {
      help,
      format,
      profile: profile ?? "",
      startPath: positional[0] ?? cwd
    };
  }

  if (profile === undefined) {
    return "Expected --profile <name|path>.";
  }

  if (positional.length > 1) {
    return "Expected at most one project path.";
  }

  return {
    help,
    format,
    profile,
    startPath: positional[0] ?? cwd
  };
}

function resolveProfilePath(profile: string, loadedProject: LoadedProject, cwd: string): string {
  if (isProfilePath(profile)) {
    return resolve(cwd, profile);
  }

  const configuredProfilePath = loadedProject.project.profiles?.[profile];

  if (configuredProfilePath !== undefined) {
    return resolve(loadedProject.paths.projectRoot, configuredProfilePath);
  }

  return resolve(loadedProject.paths.projectRoot, "profiles", `${profile}.yml`);
}

function isProfilePath(profile: string): boolean {
  return (
    isAbsolute(profile) ||
    profile.includes("/") ||
    profile.includes("\\") ||
    extname(profile) !== ""
  );
}

function writeReport(
  report: Parameters<typeof formatFitText>[0],
  parsedArgs: ParsedFitArgs,
  options: FitCommandOptions
): void {
  const formatted = parsedArgs.format === "json" ? formatFitJson(report) : formatFitText(report);
  options.stdout(formatted);
}
