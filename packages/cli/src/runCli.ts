import { runBuildCommand } from "./commands/build.js";
import { runCheckCommand } from "./commands/check.js";
import { runDiffCommand } from "./commands/diff.js";
import { runDoctorCommand } from "./commands/doctor.js";
import { runFitCommand } from "./commands/fit.js";
import { runForkCommand } from "./commands/fork.js";
import { runInitCommand } from "./commands/init.js";
import { runLibraryCommand } from "./commands/library.js";
import { runPublishCommand } from "./commands/publish.js";
import { runSuggestTestsCommand } from "./commands/suggestTests.js";
import { runTestCommand } from "./commands/test.js";

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

export interface RunCliOptions {
  readonly cwd?: string;
  readonly io?: CliIo;
}

export async function runCli(
  argv: readonly string[],
  options: RunCliOptions = {}
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const io = options.io ?? {
    stdout: (text: string) => {
      process.stdout.write(text);
    },
    stderr: (text: string) => {
      process.stderr.write(text);
    }
  };
  const args = argv.slice(2);
  const command = args[0];

  if (command === undefined || command === "--help" || command === "-h") {
    io.stdout(formatMainHelp());
    return 0;
  }

  if (command === "check") {
    return runCheckCommand(args.slice(1), {
      cwd,
      stdout: io.stdout,
      stderr: io.stderr
    });
  }

  if (command === "diff") {
    return runDiffCommand(args.slice(1), {
      cwd,
      stdout: io.stdout,
      stderr: io.stderr
    });
  }

  if (command === "build") {
    return runBuildCommand(args.slice(1), {
      cwd,
      stdout: io.stdout,
      stderr: io.stderr
    });
  }

  if (command === "doctor") {
    return runDoctorCommand(args.slice(1), {
      cwd,
      stdout: io.stdout,
      stderr: io.stderr
    });
  }

  if (command === "fit") {
    return runFitCommand(args.slice(1), {
      cwd,
      stdout: io.stdout,
      stderr: io.stderr
    });
  }

  if (command === "init") {
    return runInitCommand(args.slice(1), {
      cwd,
      stdout: io.stdout,
      stderr: io.stderr
    });
  }

  if (command === "publish") {
    return runPublishCommand(args.slice(1), {
      cwd,
      stdout: io.stdout,
      stderr: io.stderr
    });
  }

  if (command === "suggest-tests") {
    return runSuggestTestsCommand(args.slice(1), {
      cwd,
      stdout: io.stdout,
      stderr: io.stderr
    });
  }

  if (command === "test") {
    return runTestCommand(args.slice(1), {
      cwd,
      stdout: io.stdout,
      stderr: io.stderr
    });
  }

  if (command === "library") {
    return runLibraryCommand(args.slice(1), {
      cwd,
      stdout: io.stdout,
      stderr: io.stderr
    });
  }

  if (command === "fork") {
    return runForkCommand(args.slice(1), {
      cwd,
      stdout: io.stdout,
      stderr: io.stderr
    });
  }

  io.stderr(`Unknown command: ${command}\n\n${formatMainHelp()}`);
  return 2;
}

export function formatMainHelp(): string {
  return [
    "Usage: loom <command>",
    "",
    "Commands:",
    "  build  Collect referenced files into output and write a manifest.",
    "  check  Validate a Loomit project.",
    "  diff   Compare two Loomit part files semantically.",
    "  doctor Explain Loomit project diagnostics.",
    "  fit    Compare a Loomit project against a body profile.",
    "  fork   Copy an existing Loomit project.",
    "  init   Create a Loomit project in the current directory.",
    "  library List published Loomit library parts.",
    "  publish Copy a part into the Loomit library.",
    "  suggest-tests Suggest movement tests for a project.",
    "  test   Run a movement test risk check.",
    "",
    "Run loom <command> --help for command-specific options."
  ].join("\n") + "\n";
}
