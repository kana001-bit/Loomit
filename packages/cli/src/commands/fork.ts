import { forkProject } from "@loomit/core";
import { formatDiagnosticsText } from "../formatters/diagnosticsText.js";

export interface ForkCommandOptions {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

interface ParsedForkArgs {
  readonly help: boolean;
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly name?: string;
}

export async function runForkCommand(
  args: readonly string[],
  options: ForkCommandOptions
): Promise<number> {
  const parsedArgs = parseForkArgs(args, options.cwd);

  if (typeof parsedArgs === "string") {
    options.stderr(`${parsedArgs}\n\n${formatForkHelp()}`);
    return 2;
  }

  if (parsedArgs.help) {
    options.stdout(formatForkHelp());
    return 0;
  }

  const result = await forkProject({
    sourcePath: parsedArgs.sourcePath,
    targetPath: parsedArgs.targetPath,
    ...(parsedArgs.name === undefined ? {} : { name: parsedArgs.name })
  });

  if (!result.ok) {
    options.stderr(`${formatDiagnosticsText(result.diagnostics).join("\n")}\n`);
    return 1;
  }

  options.stdout(
    `Forked Loomit project: ${result.value.sourceProjectRoot} -> ${result.value.targetProjectRoot}\n`
  );
  return 0;
}

export function formatForkHelp(): string {
  return [
    "Usage: loom fork <source> <target> [--name name]",
    "",
    "Copy an existing Loomit project as the starting point for a new garment.",
    "",
    "Options:",
    "  --name name  Project name for the fork. Defaults to the target directory name.",
    "  --help       Show this help."
  ].join("\n") + "\n";
}

function parseForkArgs(args: readonly string[], cwd: string): ParsedForkArgs | string {
  let help = false;
  let name: string | undefined;
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (arg === "--name") {
      const value = args[index + 1];

      if (value === undefined || value.startsWith("--")) {
        return "Expected --name to be followed by a project name.";
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
      sourcePath: cwd,
      targetPath: cwd
    };
  }

  if (positional.length !== 2) {
    return "Expected source and target project paths.";
  }

  return {
    help,
    sourcePath: positional[0] ?? cwd,
    targetPath: positional[1] ?? cwd,
    ...(name === undefined ? {} : { name })
  };
}
