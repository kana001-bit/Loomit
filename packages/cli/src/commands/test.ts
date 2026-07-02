import { access } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  createMovementTestReport,
  loadProject,
  loadPrototypeNotesFile,
  resolveParts,
  runMovementTest
} from "@loomit/core";
import { formatMovementTestJson } from "../formatters/movementTestJson.js";
import { formatMovementTestText } from "../formatters/movementTestText.js";
import type { LoadedProject, MovementTestReport, PrototypeNotes } from "@loomit/core";

export type MovementTestOutputFormat = "text" | "json";

export interface TestCommandOptions {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

interface ParsedTestArgs {
  readonly help: boolean;
  readonly scenario: string;
  readonly startPath: string;
  readonly format: MovementTestOutputFormat;
  readonly notesPath?: string;
}

export async function runTestCommand(
  args: readonly string[],
  options: TestCommandOptions
): Promise<number> {
  const parsedArgs = parseTestArgs(args, options.cwd);

  if (typeof parsedArgs === "string") {
    options.stderr(`${parsedArgs}\n\n${formatTestHelp()}`);
    return 2;
  }

  if (parsedArgs.help) {
    options.stdout(formatTestHelp());
    return 0;
  }

  const projectResult = await loadProject(parsedArgs.startPath);

  if (!projectResult.ok) {
    writeReport(
      createMovementTestReport({
        scenario: parsedArgs.scenario,
        diagnostics: projectResult.diagnostics
      }),
      parsedArgs,
      options
    );
    return 1;
  }

  const resolvedProjectResult = await resolveParts(projectResult.value);

  if (!resolvedProjectResult.ok) {
    writeReport(
      createMovementTestReport({
        scenario: parsedArgs.scenario,
        diagnostics: resolvedProjectResult.diagnostics
      }),
      parsedArgs,
      options
    );
    return 1;
  }

  const prototypeNotesResult = await loadPrototypeNotesForMovementTest(
    projectResult.value,
    parsedArgs.notesPath
  );

  if (!prototypeNotesResult.ok) {
    writeReport(
      createMovementTestReport({
        scenario: parsedArgs.scenario,
        diagnostics: prototypeNotesResult.diagnostics
      }),
      parsedArgs,
      options
    );
    return 1;
  }

  const report = runMovementTest(resolvedProjectResult.value, parsedArgs.scenario, {
    ...(prototypeNotesResult.value === undefined
      ? {}
      : { prototypeNotes: prototypeNotesResult.value })
  });
  writeReport(report, parsedArgs, options);

  return report.status === "error" ? 1 : 0;
}

export function formatTestHelp(): string {
  return [
    "Usage: loom test <scenario> [path] [--notes path] [--format text|json]",
    "",
    "Run a movement test risk check for a Loomit project.",
    "",
    "Options:",
    "  --notes path        Prototype notes file. Defaults to notes/prototype-notes.yml when present.",
    "  --format text|json  Output format. Defaults to text.",
    "  --help              Show this help."
  ].join("\n") + "\n";
}

function parseTestArgs(args: readonly string[], cwd: string): ParsedTestArgs | string {
  let help = false;
  let format: MovementTestOutputFormat = "text";
  let notesPath: string | undefined;
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (arg === "--notes") {
      const value = args[index + 1];

      if (value === undefined || value.startsWith("--")) {
        return "Expected --notes to be followed by a path.";
      }

      notesPath = resolve(cwd, value);
      index += 1;
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

  if (help) {
    return {
      help,
      scenario: "arm-raise",
      startPath: cwd,
      format,
      ...(notesPath === undefined ? {} : { notesPath })
    };
  }

  const scenario = positional[0];

  if (scenario === undefined) {
    return "Expected a movement test scenario.";
  }

  if (positional.length > 2) {
    return "Expected at most one project path after the scenario.";
  }

  return {
    help,
    scenario,
    startPath: positional[1] ?? cwd,
    format,
    ...(notesPath === undefined ? {} : { notesPath })
  };
}

async function loadPrototypeNotesForMovementTest(
  loadedProject: LoadedProject,
  notesPath: string | undefined
): Promise<
  | { readonly ok: true; readonly value: PrototypeNotes | undefined }
  | { readonly ok: false; readonly diagnostics: MovementTestReport["diagnostics"] }
> {
  const resolvedNotesPath =
    notesPath ?? join(loadedProject.paths.projectRoot, "notes/prototype-notes.yml");

  if (notesPath === undefined && !(await pathExists(resolvedNotesPath))) {
    return {
      ok: true,
      value: undefined
    };
  }

  const prototypeNotesResult = await loadPrototypeNotesFile(resolvedNotesPath);

  if (!prototypeNotesResult.ok) {
    return prototypeNotesResult;
  }

  return {
    ok: true,
    value: prototypeNotesResult.value
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function writeReport(
  report: MovementTestReport,
  parsedArgs: ParsedTestArgs,
  options: TestCommandOptions
): void {
  const formatted =
    parsedArgs.format === "json"
      ? formatMovementTestJson(report)
      : formatMovementTestText(report);
  options.stdout(formatted);
}
