import { access } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  createTestSuggestionReport,
  loadProject,
  loadPrototypeNotesFile,
  resolveParts,
  suggestTests
} from "@loomit/core";
import { formatTestSuggestionsJson } from "../formatters/testSuggestionsJson.js";
import { formatTestSuggestionsText } from "../formatters/testSuggestionsText.js";
import type { LoadedProject, TestSuggestionReport } from "@loomit/core";
import type { PrototypeNotes } from "@loomit/core";

export type SuggestTestsOutputFormat = "text" | "json";

export interface SuggestTestsCommandOptions {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

interface ParsedSuggestTestsArgs {
  readonly help: boolean;
  readonly format: SuggestTestsOutputFormat;
  readonly startPath: string;
  readonly notesPath?: string;
}

export async function runSuggestTestsCommand(
  args: readonly string[],
  options: SuggestTestsCommandOptions
): Promise<number> {
  const parsedArgs = parseSuggestTestsArgs(args, options.cwd);

  if (typeof parsedArgs === "string") {
    options.stderr(`${parsedArgs}\n\n${formatSuggestTestsHelp()}`);
    return 2;
  }

  if (parsedArgs.help) {
    options.stdout(formatSuggestTestsHelp());
    return 0;
  }

  const projectResult = await loadProject(parsedArgs.startPath);

  if (!projectResult.ok) {
    writeReport(createTestSuggestionReport({ diagnostics: projectResult.diagnostics }), parsedArgs, options);
    return 1;
  }

  const resolvedProjectResult = await resolveParts(projectResult.value);

  if (!resolvedProjectResult.ok) {
    writeReport(
      createTestSuggestionReport({ diagnostics: resolvedProjectResult.diagnostics }),
      parsedArgs,
      options
    );
    return 1;
  }

  const prototypeNotesResult = await loadPrototypeNotesForSuggestTests(
    projectResult.value,
    parsedArgs.notesPath
  );

  if (!prototypeNotesResult.ok) {
    writeReport(
      createTestSuggestionReport({ diagnostics: prototypeNotesResult.diagnostics }),
      parsedArgs,
      options
    );
    return 1;
  }

  const report = suggestTests(resolvedProjectResult.value, {
    ...(prototypeNotesResult.value === undefined
      ? {}
      : { prototypeNotes: prototypeNotesResult.value })
  });
  writeReport(report, parsedArgs, options);

  return report.status === "error" ? 1 : 0;
}

export function formatSuggestTestsHelp(): string {
  return [
    "Usage: loom suggest-tests [path] [--notes path] [--format text|json]",
    "",
    "Suggest movement tests for the current project.",
    "",
    "Options:",
    "  --notes path        Prototype notes file. Defaults to notes/prototype-notes.yml when present.",
    "  --format text|json  Output format. Defaults to text.",
    "  --help              Show this help."
  ].join("\n") + "\n";
}

function parseSuggestTestsArgs(
  args: readonly string[],
  cwd: string
): ParsedSuggestTestsArgs | string {
  let format: SuggestTestsOutputFormat = "text";
  let help = false;
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

  if (positional.length > 1) {
    return "Expected at most one project path.";
  }

  return {
    help,
    format,
    startPath: positional[0] ?? cwd,
    ...(notesPath === undefined ? {} : { notesPath })
  };
}

async function loadPrototypeNotesForSuggestTests(
  loadedProject: LoadedProject,
  notesPath: string | undefined
): Promise<
  | { readonly ok: true; readonly value: PrototypeNotes | undefined }
  | { readonly ok: false; readonly diagnostics: TestSuggestionReport["diagnostics"] }
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
  report: TestSuggestionReport,
  parsedArgs: ParsedSuggestTestsArgs,
  options: SuggestTestsCommandOptions
): void {
  const formatted =
    parsedArgs.format === "json"
      ? formatTestSuggestionsJson(report)
      : formatTestSuggestionsText(report);
  options.stdout(formatted);
}
