import { runAddCommand } from "./commands/add.js";
import { runBuildCommand } from "./commands/build.js";
import { runCheckCommand } from "./commands/check.js";
import { runConnectCommand } from "./commands/connect.js";
import { runDiffCommand } from "./commands/diff.js";
import { runDoctorCommand } from "./commands/doctor.js";
import { runFitCommand } from "./commands/fit.js";
import { runForkCommand } from "./commands/fork.js";
import { runInitCommand } from "./commands/init.js";
import { runMatchCommand } from "./commands/match.js";
import { runNoteCommand } from "./commands/note.js";
import { runSlntCommand } from "./commands/slnt.js";
import { runSuggestTestsCommand } from "./commands/suggestTests.js";
import { runTestCommand } from "./commands/test.js";
import { runTruerCommand } from "./commands/truer.js";
import type { SeamlintRunner } from "./commands/seamlintCheck.js";
import type { TruerRunner } from "./commands/truerPropose.js";
import type { Prompter } from "./prompter.js";

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

export interface RunCliOptions {
  readonly cwd?: string;
  readonly io?: CliIo;
  // 対話コマンド(add)用。テストは scripted Prompter を注入する。未指定なら readline で対話する。
  readonly prompter?: Prompter;
  // slnt check 用。テストは fake runner を注入する。未指定なら subprocess で slnt を呼ぶ。
  readonly seamlintRunner?: SeamlintRunner;
  // match --reference 用。テストは fake runner を注入する。未指定なら subprocess で tru を呼ぶ。
  readonly truerRunner?: TruerRunner;
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

  if (command === "add") {
    return runAddCommand(args.slice(1), {
      cwd,
      stdout: io.stdout,
      stderr: io.stderr,
      // exactOptionalPropertyTypes: 未指定の prompter は渡さず、add 側の readline default に委ねる。
      ...(options.prompter === undefined ? {} : { prompter: options.prompter })
    });
  }

  if (command === "note") {
    return runNoteCommand(args.slice(1), {
      cwd,
      stdout: io.stdout,
      stderr: io.stderr,
      // exactOptionalPropertyTypes: 未指定の prompter は渡さず、note 側の readline default に委ねる。
      ...(options.prompter === undefined ? {} : { prompter: options.prompter })
    });
  }

  if (command === "check") {
    return runCheckCommand(args.slice(1), {
      cwd,
      stdout: io.stdout,
      stderr: io.stderr
    });
  }

  if (command === "connect") {
    return runConnectCommand(args.slice(1), {
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

  if (command === "match") {
    return runMatchCommand(args.slice(1), {
      cwd,
      stdout: io.stdout,
      stderr: io.stderr,
      // slnt check と同じ runner を注入口として共有する(テストは fake、既定は subprocess)。
      ...(options.seamlintRunner === undefined ? {} : { runner: options.seamlintRunner }),
      ...(options.truerRunner === undefined ? {} : { truerRunner: options.truerRunner })
    });
  }

  if (command === "slnt") {
    return runSlntCommand(args.slice(1), {
      cwd,
      stdout: io.stdout,
      stderr: io.stderr,
      ...(options.seamlintRunner === undefined ? {} : { seamlintRunner: options.seamlintRunner })
    });
  }

  if (command === "truer") {
    return runTruerCommand(args.slice(1), {
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
  return (
    [
      "Usage: loom <command>",
      "",
      "Commands:",
      "  add    Add a Valentina .val to the project as a part.",
      "  build  Collect referenced files into output and write a manifest.",
      "  check  Validate a Loomit project.",
      "  connect Declare that two parts sew together (writes a paired connector).",
      "  diff   Compare two Loomit part files semantically.",
      "  doctor Explain Loomit project diagnostics.",
      "  fit    Compare a Loomit project against a body profile.",
      "  fork   Copy an existing Loomit project.",
      "  init   Create a Loomit project in the current directory.",
      "  match  Measure the seam(s) joining two parts and report if they match.",
      "  note   Record a prototype note into notes/prototype-notes.yml.",
      "  slnt   Geometry checks via Seamlint (loom slnt request|check).",
      "  truer  Constraint payload handoff for Truer (loom truer request).",
      "  suggest-tests Suggest movement tests for a project.",
      "  test   Run a movement test risk check.",
      "",
      "Run loom <command> --help for command-specific options."
    ].join("\n") + "\n"
  );
}
