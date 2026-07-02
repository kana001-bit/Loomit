import { homedir } from "node:os";
import { resolve } from "node:path";

import { publishPart } from "@loomit/core";
import { formatDiagnosticsText } from "../formatters/diagnosticsText.js";

export interface PublishCommandOptions {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

interface ParsedPublishArgs {
  readonly help: boolean;
  readonly partPath: string;
  readonly libraryRoot: string;
  readonly name?: string;
}

export async function runPublishCommand(
  args: readonly string[],
  options: PublishCommandOptions
): Promise<number> {
  const parsedArgs = parsePublishArgs(args, options.cwd);

  if (typeof parsedArgs === "string") {
    options.stderr(`${parsedArgs}\n\n${formatPublishHelp()}`);
    return 2;
  }

  if (parsedArgs.help) {
    options.stdout(formatPublishHelp());
    return 0;
  }

  const result = await publishPart({
    partPath: parsedArgs.partPath,
    libraryRoot: parsedArgs.libraryRoot,
    ...(parsedArgs.name === undefined ? {} : { name: parsedArgs.name })
  });

  if (!result.ok) {
    options.stderr(`${formatDiagnosticsText(result.diagnostics).join("\n")}\n`);
    return 1;
  }

  options.stdout(
    `Published Loomit part: ${result.value.sourcePartDirectory} -> ${result.value.targetPartDirectory}\n`
  );
  return 0;
}

export function formatPublishHelp(): string {
  return [
    "Usage: loom publish <part-path> [--library path] [--name name]",
    "",
    "Copy a part directory into the Loomit library.",
    "",
    "Options:",
    "  --library path  Library root. Defaults to ~/.loomit/library.",
    "  --name name     Published library entry name. Defaults to the part name.",
    "  --help          Show this help."
  ].join("\n") + "\n";
}

function parsePublishArgs(args: readonly string[], cwd: string): ParsedPublishArgs | string {
  let help = false;
  let libraryRoot = resolve(homedir(), ".loomit/library");
  let name: string | undefined;
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (arg === "--library") {
      const value = args[index + 1];

      if (value === undefined || value.startsWith("--")) {
        return "Expected --library to be followed by a path.";
      }

      libraryRoot = resolve(cwd, value);
      index += 1;
      continue;
    }

    if (arg === "--name") {
      const value = args[index + 1];

      if (value === undefined || value.startsWith("--")) {
        return "Expected --name to be followed by a library entry name.";
      }

      name = value;
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
      partPath: cwd,
      libraryRoot
    };
  }

  if (positional.length !== 1) {
    return "Expected exactly one part path.";
  }

  return {
    help,
    partPath: resolve(cwd, positional[0] ?? "."),
    libraryRoot,
    ...(name === undefined ? {} : { name })
  };
}
