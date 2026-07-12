import { dirname, relative } from "node:path";

import { connectParts } from "@loomit/core";
import type { ConnectedParts, ConnectedSide } from "@loomit/core";
import { formatDiagnosticsText } from "../formatters/diagnosticsText.js";

export interface ConnectCommandOptions {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

interface ParsedConnectArgs {
  readonly help: boolean;
  readonly roleA?: string;
  readonly roleB?: string;
  readonly id?: string;
  readonly type?: string;
  readonly notchCount?: number;
  readonly pathRefA?: string;
  readonly pathRefB?: string;
}

// loom connect: 既に add 済みの2パーツを「縫い合う」と宣言する薄いヘルパ。両 part.loom に同じ id の connector を
// 対で書くだけ(check がその id でペアにする)。人が渡すのはトークン(id / path_ref=DXF BLOCK 名 / notch_count)で、
// どの辺が共有縫い線かは Seamlint が幾何から発見する。辺の座標は一切訊かない(part-part 入力にとどめる)。
export async function runConnectCommand(
  args: readonly string[],
  options: ConnectCommandOptions
): Promise<number> {
  const parsedArgs = parseConnectArgs(args);

  if (typeof parsedArgs === "string") {
    options.stderr(`${parsedArgs}\n\n${formatConnectHelp()}`);
    return 2;
  }

  if (parsedArgs.help) {
    options.stdout(formatConnectHelp());
    return 0;
  }

  if (
    parsedArgs.roleA === undefined ||
    parsedArgs.roleB === undefined ||
    parsedArgs.id === undefined
  ) {
    options.stderr(`Expected two part roles and --as <id>.\n\n${formatConnectHelp()}`);
    return 2;
  }

  const result = await connectParts({
    projectPath: options.cwd,
    roleA: parsedArgs.roleA,
    roleB: parsedArgs.roleB,
    id: parsedArgs.id,
    ...(parsedArgs.type === undefined ? {} : { type: parsedArgs.type }),
    ...(parsedArgs.notchCount === undefined ? {} : { notchCount: parsedArgs.notchCount }),
    ...(parsedArgs.pathRefA === undefined ? {} : { pathRefA: parsedArgs.pathRefA }),
    ...(parsedArgs.pathRefB === undefined ? {} : { pathRefB: parsedArgs.pathRefB })
  });

  if (!result.ok) {
    options.stderr(`${formatDiagnosticsText(result.diagnostics).join("\n")}\n`);
    return 1;
  }

  options.stdout(formatConnectSuccess(result.value));
  return 0;
}

export function formatConnectHelp(): string {
  return (
    [
      "Usage: loom connect <roleA> <roleB> --as <id> [options]",
      "",
      "Declare that two parts sew together. Writes a connector with the same id",
      "into both parts' part.loom, so loom check pairs them and loom slnt check",
      "measures the shared seam. You give tokens, not edges: which edge is the",
      "shared seam is found by Seamlint from the geometry.",
      "",
      "Options:",
      "  --as <id>          Connector id (required). The same id is written to both",
      "                     parts; that is what pairs them.",
      "  --type <type>      Seam type label (e.g. side, armhole). Defaults to the id.",
      "  --notches <n>      Notch count on this seam (a non-negative integer). Helps",
      "                     Seamlint tell apart two seams that share the same pieces.",
      "  --path-ref-a <b>   DXF BLOCK name for the first part. Defaults to its",
      "  --path-ref-b <b>   files.piece. Block matching ignores case.",
      "  --help             Show this help.",
      "",
      "Example:",
      "  loom connect front back --as outseam --notches 2"
    ].join("\n") + "\n"
  );
}

function formatConnectSuccess(connected: ConnectedParts): string {
  const projectRoot = dirname(connected.projectFilePath);
  const rel = (target: string): string => relative(projectRoot, target).split("\\").join("/");

  const [sideA, sideB] = connected.sides;
  const notch = connected.notchCount === undefined ? "" : `  notch_count: ${connected.notchCount}`;

  const lines = [
    `Connected "${sideA.role}" ↔ "${sideB.role}" as "${connected.id}":`,
    `  ${rel(sideA.filePath)}   (connectors.${connected.id})`,
    `  ${rel(sideB.filePath)}   (connectors.${connected.id})`,
    `  type: ${connected.type}${notch}`
  ];

  // path_ref を既定(files.piece)から採れなかった側は、Seamlint に幾何の在り処を示せない。何を足せばよいか示す。
  const missingPathRef = connected.sides.filter(
    (side: ConnectedSide) => side.pathRef === undefined
  );

  for (const side of missingPathRef) {
    lines.push(
      `  Note: part "${side.role}" has no files.piece to default path_ref from; set connectors.${connected.id}.path_ref (the DXF BLOCK name) so Seamlint can find the seam.`
    );
  }

  // geometry ソース(files.geometry / files.preview)が無い側は、宣言できても slnt check はまだ測れない。
  const missingGeometry = connected.sides.filter((side: ConnectedSide) => !side.hasGeometrySource);

  for (const side of missingGeometry) {
    lines.push(
      `  Note: part "${side.role}" has no files.geometry or files.preview yet; loom slnt check can't measure this seam until you add one.`
    );
  }

  lines.push("", "Next: loom slnt check");

  return `${lines.join("\n")}\n`;
}

function parseConnectArgs(args: readonly string[]): ParsedConnectArgs | string {
  let help = false;
  let id: string | undefined;
  let type: string | undefined;
  let notchCount: number | undefined;
  let pathRefA: string | undefined;
  let pathRefB: string | undefined;
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === undefined) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (arg === "--as" || arg === "--id") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return "Expected --as to be followed by a connector id.";
      }
      id = value;
      index += 1;
      continue;
    }

    if (arg === "--type") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return "Expected --type to be followed by a seam type.";
      }
      type = value;
      index += 1;
      continue;
    }

    if (arg === "--notches") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return "Expected --notches to be followed by a non-negative integer.";
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return "Expected --notches to be a non-negative integer (e.g. 0, 1, 2).";
      }
      notchCount = parsed;
      index += 1;
      continue;
    }

    if (arg === "--path-ref-a") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return "Expected --path-ref-a to be followed by a DXF BLOCK name.";
      }
      pathRefA = value;
      index += 1;
      continue;
    }

    if (arg === "--path-ref-b") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return "Expected --path-ref-b to be followed by a DXF BLOCK name.";
      }
      pathRefB = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      return `Unknown option: ${arg}`;
    }

    positional.push(arg);
  }

  if (positional.length > 2) {
    return "Expected exactly two part roles.";
  }

  return {
    help,
    ...(positional[0] === undefined ? {} : { roleA: positional[0] }),
    ...(positional[1] === undefined ? {} : { roleB: positional[1] }),
    ...(id === undefined ? {} : { id }),
    ...(type === undefined ? {} : { type }),
    ...(notchCount === undefined ? {} : { notchCount }),
    ...(pathRefA === undefined ? {} : { pathRefA }),
    ...(pathRefB === undefined ? {} : { pathRefB })
  };
}
