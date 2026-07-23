import {
  runTruerRequestCommand,
  type TruerRequestCommandOptions
} from "./truerRequest.js";

export type TruerCommandOptions = TruerRequestCommandOptions;

// truer = Truer 連携の名前空間。相棒ツール Truer と同じ token に揃えている(slnt と同じ流儀)。
// 現状は request(拘束 payload の組み立て)だけ。測定は slnt、修正提案は Truer 本体という責務境界を保つため、
// ここには payload の handoff だけを置く。
export async function runTruerCommand(
  args: readonly string[],
  options: TruerCommandOptions
): Promise<number> {
  const subcommand = args[0];

  if (subcommand === "--help" || subcommand === "-h") {
    options.stdout(formatTruerHelp());
    return 0;
  }

  if (subcommand === "request") {
    return runTruerRequestCommand(args.slice(1), options);
  }

  const message =
    subcommand === undefined
      ? "Expected truer subcommand: request."
      : `Unknown truer subcommand: ${subcommand}`;
  options.stderr(`${message}\n\n${formatTruerHelp()}`);
  return 2;
}

export function formatTruerHelp(): string {
  return [
    "Usage: loom truer <command>",
    "",
    "Commands:",
    "  request  Build a constraint payload handoff for Truer.",
    "",
    "Run loom truer <command> --help for command-specific options."
  ].join("\n") + "\n";
}
