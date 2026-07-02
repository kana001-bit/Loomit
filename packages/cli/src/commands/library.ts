import { homedir } from "node:os";
import { resolve } from "node:path";

import { addLibraryPartToProject, listLibraryParts } from "@loomit/core";
import { formatDiagnosticsText } from "../formatters/diagnosticsText.js";
import { formatLibraryJson } from "../formatters/libraryJson.js";
import { formatLibraryText } from "../formatters/libraryText.js";

export type LibraryOutputFormat = "text" | "json";

export interface LibraryCommandOptions {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

interface ParsedLibraryListArgs {
  readonly command: "list";
  readonly help: boolean;
  readonly libraryRoot: string;
  readonly format: LibraryOutputFormat;
  readonly type?: string;
}

interface ParsedLibraryAddArgs {
  readonly command: "add";
  readonly help: boolean;
  readonly libraryRoot: string;
  readonly projectPath: string;
  readonly type: string;
  readonly name: string;
  readonly role?: string;
  readonly localName?: string;
  readonly replace: boolean;
}

type ParsedLibraryArgs = ParsedLibraryListArgs | ParsedLibraryAddArgs;

export async function runLibraryCommand(
  args: readonly string[],
  options: LibraryCommandOptions
): Promise<number> {
  const parsedArgs = parseLibraryArgs(args, options.cwd);

  if (typeof parsedArgs === "string") {
    options.stderr(`${parsedArgs}\n\n${formatLibraryHelp()}`);
    return 2;
  }

  if (parsedArgs.help) {
    options.stdout(formatLibraryHelp());
    return 0;
  }

  if (parsedArgs.command === "add") {
    const result = await addLibraryPartToProject({
      libraryRoot: parsedArgs.libraryRoot,
      projectPath: parsedArgs.projectPath,
      type: parsedArgs.type,
      name: parsedArgs.name,
      replace: parsedArgs.replace,
      ...(parsedArgs.role === undefined ? {} : { role: parsedArgs.role }),
      ...(parsedArgs.localName === undefined ? {} : { localName: parsedArgs.localName })
    });

    if (!result.ok) {
      options.stderr(`${formatDiagnosticsText(result.diagnostics).join("\n")}\n`);
      return 1;
    }

    options.stdout(
      `Added Loomit library part: ${result.value.sourcePartDirectory} -> ${result.value.targetPartDirectory}\n`
    );
    return 0;
  }

  const result = await listLibraryParts({
    libraryRoot: parsedArgs.libraryRoot,
    ...(parsedArgs.type === undefined ? {} : { type: parsedArgs.type })
  });

  if (!result.ok) {
    options.stderr(`${formatDiagnosticsText(result.diagnostics).join("\n")}\n`);
    return 1;
  }

  options.stdout(
    parsedArgs.format === "json" ? formatLibraryJson(result.value) : formatLibraryText(result.value)
  );
  return 0;
}

export function formatLibraryHelp(): string {
  return [
    "Usage: loom library <command>",
    "",
    "Commands:",
    "  list  List published Loomit library parts.",
    "  add   Copy a published library part into a project.",
    "",
    "Usage:",
    "  loom library list [--library path] [--type type] [--format text|json]",
    "  loom library add <type/name> [project] [--library path] [--role role] [--as name] [--replace]",
    "",
    "Options:",
    "  --library path     Library root. Defaults to ~/.loomit/library.",
    "  --type type        Filter by part type.",
    "  --role role        Project part role for add. Defaults to the part type.",
    "  --as name          Local project part directory name for add.",
    "  --replace          Allow add to update an existing project part role.",
    "  --format text|json Output format. Defaults to text.",
    "  --help             Show this help."
  ].join("\n") + "\n";
}

function parseLibraryArgs(args: readonly string[], cwd: string): ParsedLibraryArgs | string {
  let help = false;
  let libraryRoot = resolve(homedir(), ".loomit/library");
  let format: LibraryOutputFormat = "text";
  let type: string | undefined;
  let role: string | undefined;
  let localName: string | undefined;
  let replace = false;
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

    if (arg === "--type") {
      const value = args[index + 1];

      if (value === undefined || value.startsWith("--")) {
        return "Expected --type to be followed by a part type.";
      }

      type = value;
      index += 1;
      continue;
    }

    if (arg === "--role") {
      const value = args[index + 1];

      if (value === undefined || value.startsWith("--")) {
        return "Expected --role to be followed by a project part role.";
      }

      role = value;
      index += 1;
      continue;
    }

    if (arg === "--as") {
      const value = args[index + 1];

      if (value === undefined || value.startsWith("--")) {
        return "Expected --as to be followed by a local part name.";
      }

      localName = value;
      index += 1;
      continue;
    }

    if (arg === "--replace") {
      replace = true;
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
      command: "list",
      help,
      libraryRoot,
      format,
      ...(type === undefined ? {} : { type })
    };
  }

  const command = positional[0];

  if (command === "list") {
    if (positional.length !== 1) {
      return "Expected no positional arguments after library list.";
    }

    return {
      command,
      help,
      libraryRoot,
      format,
      ...(type === undefined ? {} : { type })
    };
  }

  if (command === "add") {
    const identifier = positional[1];

    if (identifier === undefined) {
      return "Expected library add to be followed by <type/name>.";
    }

    const parsedIdentifier = parseLibraryPartIdentifier(identifier);

    if (parsedIdentifier === undefined) {
      return "Expected library part identifier in the form <type/name>.";
    }

    if (positional.length > 3) {
      return "Expected at most one project path after <type/name>.";
    }

    return {
      command,
      help,
      libraryRoot,
      projectPath: resolve(cwd, positional[2] ?? "."),
      type: parsedIdentifier.type,
      name: parsedIdentifier.name,
      replace,
      ...(role === undefined ? {} : { role }),
      ...(localName === undefined ? {} : { localName })
    };
  }

  return "Expected library subcommand: list or add.";
}

function parseLibraryPartIdentifier(
  identifier: string
): { readonly type: string; readonly name: string } | undefined {
  const [type, name, ...extra] = identifier.split("/");

  if (type === undefined || type === "" || name === undefined || name === "" || extra.length > 0) {
    return undefined;
  }

  return {
    type,
    name
  };
}
