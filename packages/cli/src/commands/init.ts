import { createProject } from "@loomit/core";
import { formatDiagnosticsText } from "../formatters/diagnosticsText.js";

export interface InitCommandOptions {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

interface ParsedInitArgs {
  readonly help: boolean;
  readonly name?: string;
  readonly garment?: string;
}

export async function runInitCommand(
  args: readonly string[],
  options: InitCommandOptions
): Promise<number> {
  const parsedArgs = parseInitArgs(args);

  if (typeof parsedArgs === "string") {
    options.stderr(`${parsedArgs}\n\n${formatInitHelp()}`);
    return 2;
  }

  if (parsedArgs.help) {
    options.stdout(formatInitHelp());
    return 0;
  }

  // `loom init` initializes in the current directory (git init style).
  const result = await createProject({
    targetPath: options.cwd,
    ...(parsedArgs.name === undefined ? {} : { name: parsedArgs.name }),
    ...(parsedArgs.garment === undefined ? {} : { garment: parsedArgs.garment })
  });

  if (!result.ok) {
    options.stderr(`${formatDiagnosticsText(result.diagnostics).join("\n")}\n`);
    return 1;
  }

  options.stdout(`Created Loomit project: ${result.value.projectRoot}\n\n${formatNextSteps()}`);
  return 0;
}

// init 直後に「次に何をするか」だけを案内する。長いチュートリアルにはせず最短導線を1画面に収める。
// part.loom は手書きさせず、`loom add` に .val を渡して生成する導線に統一する(ユーザーは .val を
// 用意するだけでよい)。
export function formatNextSteps(): string {
  return [
    "Next steps:",
    "",
    "  1. Add a Valentina .val as a part (generates part.loom for you):",
    "       loom add path/to/your.val",
    "  2. Check it:  loom check",
    "  3. Build it:  loom build",
    "",
    "Run loom --help to see all commands."
  ].join("\n") + "\n";
}

export function formatInitHelp(): string {
  return [
    "Usage: loom init [--name name] [--garment garment]",
    "",
    "Create an empty Loomit project scaffold in the current directory.",
    "",
    "Options:",
    "  --name name        Project name. Defaults to the current directory name.",
    "  --garment garment  Garment kind. Defaults to unspecified.",
    "  --help             Show this help."
  ].join("\n") + "\n";
}

function parseInitArgs(args: readonly string[]): ParsedInitArgs | string {
  let help = false;
  let name: string | undefined;
  let garment: string | undefined;

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

    if (arg === "--garment") {
      const value = args[index + 1];

      if (value === undefined || value.startsWith("--")) {
        return "Expected --garment to be followed by a garment kind.";
      }

      garment = value;
      index += 1;
      continue;
    }

    if (arg?.startsWith("--") === true) {
      return `Unknown option: ${arg}`;
    }

    if (arg !== undefined) {
      return `Unexpected argument: ${arg}. loom init takes no path; it initializes the current directory.`;
    }
  }

  return omitUndefined({ help, name, garment });
}

function omitUndefined(input: {
  readonly help: boolean;
  readonly name: string | undefined;
  readonly garment: string | undefined;
}): ParsedInitArgs {
  return {
    help: input.help,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.garment === undefined ? {} : { garment: input.garment })
  };
}
