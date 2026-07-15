import {
  runSeamlintRequestCommand,
  type SeamlintRequestCommandOptions
} from "./seamlintRequest.js";
import { runSeamlintCheckCommand, type SeamlintRunner } from "./seamlintCheck.js";

export interface SlntCommandOptions extends SeamlintRequestCommandOptions {
  // slnt check が Seamlint を呼ぶ境界。テストは fake runner を注入する(未指定なら subprocess)。
  readonly seamlintRunner?: SeamlintRunner;
}

// slnt = Seamlint 連携の名前空間。相棒ツール Seamlint と同じ token に揃えている。
// request(幾何 handoff の組み立て)と check(その handoff を Seamlint に渡して seam を実測)を
// 動詞 subcommand として分け、「slnt で何をするか」をコマンド名から読めるようにしている。
export async function runSlntCommand(
  args: readonly string[],
  options: SlntCommandOptions
): Promise<number> {
  const subcommand = args[0];

  if (subcommand === "--help" || subcommand === "-h") {
    options.stdout(formatSlntHelp());
    return 0;
  }

  if (subcommand === "request") {
    return runSeamlintRequestCommand(args.slice(1), options);
  }

  if (subcommand === "check") {
    return runSeamlintCheckCommand(args.slice(1), {
      cwd: options.cwd,
      stdout: options.stdout,
      stderr: options.stderr,
      ...(options.seamlintRunner === undefined ? {} : { runner: options.seamlintRunner })
    });
  }

  const message =
    subcommand === undefined
      ? "Expected slnt subcommand: request or check."
      : `Unknown slnt subcommand: ${subcommand}`;
  options.stderr(`${message}\n\n${formatSlntHelp()}`);
  return 2;
}

export function formatSlntHelp(): string {
  return [
    "Usage: loom slnt <command>",
    "",
    "Commands:",
    "  request  Build a geometry request handoff for Seamlint.",
    "  check    Build the request and run Seamlint to measure the seams.",
    "",
    "Run loom slnt <command> --help for command-specific options."
  ].join("\n") + "\n";
}
