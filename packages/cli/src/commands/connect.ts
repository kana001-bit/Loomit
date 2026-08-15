import { dirname, relative } from "node:path";

import { connectBand, connectParts, extendJoin } from "loomit-core";
import type { ConnectedBand, ConnectedParts, ConnectedSide, ExtendedJoin } from "loomit-core";
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
  // band モード: --to があれば neighbours(1枚以上)。band role は positional[0]。
  readonly toRoles?: readonly string[];
  readonly bandSide?: string;
  readonly neighbourSide?: string;
  // 拡張モード: --join があれば「既にある縫い目に参加する」。足す part は positional[0]。
  readonly joinId?: string;
  readonly side?: string;
  readonly pathRef?: string;
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

  // --join があれば拡張モード(既にある縫い目に1枚足す)。新規作成の2形とは入口を分ける ── --as は
  // 「新しい id で張る」の意味を保ち、既存 id を黙って上書きしないガード(CONNECT_ID_ALREADY_DECLARED)も
  // そのまま残す。
  if (parsedArgs.joinId !== undefined) {
    return runConnectExtend(parsedArgs, options);
  }

  // --to があれば band モード(band 1枚 + neighbours N枚)。無ければ従来の素の2枚 seam。
  if (parsedArgs.toRoles !== undefined) {
    return runConnectBand(parsedArgs, options);
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

// 拡張モード(--join)の実行。足す part は positional[0]。新規作成用のフラグは受け付けない ── 受けると
// 「id や type を今つけている」ように読めてしまうが、拡張は既存の宣言を継ぐ操作だから。
async function runConnectExtend(
  parsedArgs: ParsedConnectArgs,
  options: ConnectCommandOptions
): Promise<number> {
  const conflicting = [
    ...(parsedArgs.id === undefined ? [] : ["--as"]),
    ...(parsedArgs.type === undefined ? [] : ["--type"]),
    ...(parsedArgs.toRoles === undefined ? [] : ["--to"]),
    ...(parsedArgs.bandSide === undefined ? [] : ["--band-side"]),
    ...(parsedArgs.neighbourSide === undefined ? [] : ["--neighbour-side"]),
    ...(parsedArgs.pathRefA === undefined ? [] : ["--path-ref-a"]),
    ...(parsedArgs.pathRefB === undefined ? [] : ["--path-ref-b"])
  ];

  if (conflicting.length > 0) {
    options.stderr(
      `${conflicting.join(", ")} cannot be combined with --join: joining an existing seam inherits its id, type, and sides.\n\n${formatConnectHelp()}`
    );
    return 2;
  }

  if (parsedArgs.roleA === undefined) {
    options.stderr(`Expected a part role before --join.\n\n${formatConnectHelp()}`);
    return 2;
  }

  if (parsedArgs.roleB !== undefined) {
    options.stderr(
      `Expected exactly one part role with --join; a seam is joined one piece at a time.\n\n${formatConnectHelp()}`
    );
    return 2;
  }

  const result = await extendJoin({
    projectPath: options.cwd,
    role: parsedArgs.roleA,
    id: parsedArgs.joinId ?? "",
    ...(parsedArgs.side === undefined ? {} : { side: parsedArgs.side }),
    ...(parsedArgs.notchCount === undefined ? {} : { notchCount: parsedArgs.notchCount }),
    ...(parsedArgs.pathRef === undefined ? {} : { pathRef: parsedArgs.pathRef })
  });

  if (!result.ok) {
    options.stderr(`${formatDiagnosticsText(result.diagnostics).join("\n")}\n`);
    return 1;
  }

  options.stdout(formatExtendSuccess(result.value));
  return 0;
}

// band モード(--to)の実行。band role は positional[0]、neighbours は --to の後続。band 側/neighbour 側の side は
// コマンドが裏で書くので、作者は side を一切触らない(--band-side/--neighbour-side で上書きは可)。
async function runConnectBand(
  parsedArgs: ParsedConnectArgs,
  options: ConnectCommandOptions
): Promise<number> {
  // band モードで pathRef の per-part 上書きは意味が曖昧(neighbours が可変長)なので受け付けない。
  if (parsedArgs.pathRefA !== undefined || parsedArgs.pathRefB !== undefined) {
    options.stderr(
      `--path-ref-a/--path-ref-b are only for the pairwise form; in band mode path_ref defaults to each part's files.piece.\n\n${formatConnectHelp()}`
    );
    return 2;
  }

  if (parsedArgs.roleA === undefined || parsedArgs.id === undefined) {
    options.stderr(`Expected a band part role and --as <id>.\n\n${formatConnectHelp()}`);
    return 2;
  }

  const result = await connectBand({
    projectPath: options.cwd,
    bandRole: parsedArgs.roleA,
    neighbourRoles: parsedArgs.toRoles ?? [],
    id: parsedArgs.id,
    ...(parsedArgs.type === undefined ? {} : { type: parsedArgs.type }),
    ...(parsedArgs.notchCount === undefined ? {} : { notchCount: parsedArgs.notchCount }),
    ...(parsedArgs.bandSide === undefined ? {} : { bandSide: parsedArgs.bandSide }),
    ...(parsedArgs.neighbourSide === undefined ? {} : { neighbourSide: parsedArgs.neighbourSide })
  });

  if (!result.ok) {
    options.stderr(`${formatDiagnosticsText(result.diagnostics).join("\n")}\n`);
    return 1;
  }

  options.stdout(formatConnectBandSuccess(result.value));
  return 0;
}

export function formatConnectHelp(): string {
  return (
    [
      "Usage: loom connect <roleA> <roleB> --as <id> [options]        (plain seam)",
      "       loom connect <band> --to <n1> <n2>... --as <id> [opts]  (band seam)",
      "       loom connect <role> --join <id> [--side <s>] [options]  (join an existing seam)",
      "",
      "Declare that parts sew together. Writes a connector with the same id into each",
      "part's part.loom, so loom check pairs them and loom slnt check measures the",
      "shared seam. You give tokens, not edges: which edge is the shared seam is found",
      "by Seamlint from the geometry.",
      "",
      "Three forms:",
      "  plain  two pieces sew edge-to-edge (front <-> back). No side.",
      "  band   one band piece meets many pieces whose lengths add up to it (a",
      "         waistband meets front + back). Use --to to list the many pieces; the",
      "         command writes the band/neighbour sides for you.",
      "  join   add one more piece to a seam that already exists (a lining joining the",
      "         waist seam). Inherits the seam's id and type; --side says which side it",
      "         belongs to. Growing the band's own side is refused: a band must stay one",
      "         piece, or the band-seam measurement is lost.",
      "",
      "Options:",
      "  --as <id>          Connector id (required for plain/band). The same id is",
      "                     written to every part; that is what pairs them.",
      "  --to <roles...>    Switch to band mode: the neighbour pieces the band meets.",
      "  --join <id>        Switch to join mode: the existing seam to add this part to.",
      "  --side <s>         Which side the joined part belongs to (join mode). Required",
      "                     when the seam declares sides; not allowed when it does not.",
      "  --path-ref <b>     DXF BLOCK name for the joined part (join mode).",
      "  --type <type>      Seam type label (e.g. side, armhole). Defaults to the id.",
      "  --notches <n>      Notch count on this seam (a non-negative integer), recorded",
      "                     on each part (in band mode, on the neighbours). Seamlint uses",
      "                     it to tell apart plain seams that share pieces; band seams",
      "                     find their edges by dart-folding, so there it is metadata.",
      "  --band-side <s>       Side label for the band (band mode). Default: band.",
      "  --neighbour-side <s>  Side label for the neighbours (band mode). Default:",
      "                        neighbour.",
      "  --path-ref-a <b>   DXF BLOCK name for the first part (plain form only).",
      "  --path-ref-b <b>   Defaults to files.piece. Block matching ignores case.",
      "  --help             Show this help.",
      "",
      "Examples:",
      "  loom connect front back --as outseam --notches 2",
      "  loom connect waistband --to front back --as waist --notches 2",
      "  loom connect lining --join waist --side neighbour"
    ].join("\n") + "\n"
  );
}

// 拡張の結果。**band を必ず示す**のが要点 ── band は side ラベルではなく「ちょうど1枚で残った側」で決まり、
// どちらが物理的な band かを Loomit は保持していない。側が1枚ずつだった縫い目では今回の追加で band が確定する
// ので、結果を見せて意図と違えば作者が気づけるようにする(検証はできないが可視化はできる)。
function formatExtendSuccess(extended: ExtendedJoin): string {
  const projectRoot = dirname(extended.projectFilePath);
  const rel = (target: string): string => relative(projectRoot, target).split("\\").join("/");

  const side = extended.side === undefined ? "" : `, side: ${extended.side}`;
  const notch = extended.notchCount === undefined ? "" : `, notch_count: ${extended.notchCount}`;

  const lines = [
    `Joined "${extended.added.role}" to seam "${extended.id}":`,
    `  ${rel(extended.added.filePath)}   (connectors.${extended.id}${side}${notch})`,
    `  type: ${extended.type}   (inherited)`,
    `  parts on this seam: ${extended.participants.join(", ")}`
  ];

  if (extended.bandRole !== undefined) {
    lines.push(
      `  band: ${extended.bandRole}   (the one piece left on its side; the other side's edges must add up to it)`
    );
  }

  if (extended.added.pathRef === undefined) {
    lines.push(
      `  Note: part "${extended.added.role}" has no files.piece to default path_ref from; set connectors.${extended.id}.path_ref (the DXF BLOCK name) so Seamlint can find the seam.`
    );
  }

  if (!extended.added.hasGeometrySource) {
    lines.push(
      `  Note: part "${extended.added.role}" has no files.geometry or files.preview yet; loom slnt check can't measure this seam until you add one.`
    );
  } else if (extended.bandRole !== undefined && !extended.added.hasDxfGeometry) {
    // band seam の実測は辺分割を要するので全側 DXF 必須。preview(SVG)だけでは測れない。
    lines.push(
      `  Note: part "${extended.added.role}" has only files.preview (SVG); band seams need DXF (files.geometry), so loom slnt check can't measure this seam until you add one.`
    );
  }

  lines.push("", "Next: loom slnt check");

  return `${lines.join("\n")}\n`;
}

function formatConnectBandSuccess(band: ConnectedBand): string {
  const projectRoot = dirname(band.projectFilePath);
  const rel = (target: string): string => relative(projectRoot, target).split("\\").join("/");

  const notch = band.notchCount === undefined ? "" : `, notch_count: ${band.notchCount}`;
  const neighbourRoles = band.neighbours.map((side: ConnectedSide) => `"${side.role}"`).join(", ");

  const lines = [
    `Connected band "${band.band.role}" <-> ${neighbourRoles} as "${band.id}":`,
    `  ${rel(band.band.filePath)}   (connectors.${band.id}, side: ${band.bandSide})`
  ];

  for (const side of band.neighbours) {
    lines.push(
      `  ${rel(side.filePath)}   (connectors.${band.id}, side: ${band.neighbourSide}${notch})`
    );
  }

  lines.push(`  type: ${band.type}`);

  // path_ref を既定(files.piece)から採れなかった側は、Seamlint に幾何の在り処を示せない。
  const missingPathRef = [band.band, ...band.neighbours].filter(
    (side: ConnectedSide) => side.pathRef === undefined
  );
  for (const side of missingPathRef) {
    lines.push(
      `  Note: part "${side.role}" has no files.piece to default path_ref from; set connectors.${band.id}.path_ref (the DXF BLOCK name) so Seamlint can find the seam.`
    );
  }

  // band-seam は band の辺分割(structuralEdges)を要するので全側 DXF 必須 ── preview(SVG)だけでは測れない。
  // hasGeometrySource(preview でも true)でなく hasDxfGeometry で判定し、SVG のみの側にもちゃんと注意を出す。
  const missingDxf = [band.band, ...band.neighbours].filter(
    (side: ConnectedSide) => !side.hasDxfGeometry
  );
  for (const side of missingDxf) {
    const has = side.hasGeometrySource ? "only files.preview (SVG)" : "no files.geometry";
    lines.push(
      `  Note: part "${side.role}" has ${has}; band seams need DXF (files.geometry), so loom slnt check can't measure this seam until you add one.`
    );
  }

  lines.push("", "Next: loom slnt check");

  return `${lines.join("\n")}\n`;
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
  let toRoles: string[] | undefined;
  let bandSide: string | undefined;
  let neighbourSide: string | undefined;
  let joinId: string | undefined;
  let side: string | undefined;
  let pathRef: string | undefined;
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

    if (arg === "--to") {
      const collected: string[] = [];
      while (index + 1 < args.length) {
        const next = args[index + 1];
        if (next === undefined || next.startsWith("--")) {
          break;
        }
        collected.push(next);
        index += 1;
      }
      if (collected.length === 0) {
        return "Expected --to to be followed by one or more neighbour part roles.";
      }
      toRoles = collected;
      continue;
    }

    if (arg === "--join") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return "Expected --join to be followed by an existing connector id.";
      }
      joinId = value;
      index += 1;
      continue;
    }

    if (arg === "--side") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return "Expected --side to be followed by a side label.";
      }
      side = value;
      index += 1;
      continue;
    }

    if (arg === "--path-ref") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return "Expected --path-ref to be followed by a DXF BLOCK name.";
      }
      pathRef = value;
      index += 1;
      continue;
    }

    if (arg === "--band-side") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return "Expected --band-side to be followed by a side label.";
      }
      bandSide = value;
      index += 1;
      continue;
    }

    if (arg === "--neighbour-side") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return "Expected --neighbour-side to be followed by a side label.";
      }
      neighbourSide = value;
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

  // 拡張モード(--join あり): positional は足す part の role 1つだけ。--to と同時には使えない
  // (「新しい band を張る」と「既存の縫い目に参加する」は別の操作)。
  if (joinId !== undefined) {
    if (positional.length > 1) {
      return "Expected exactly one part role with --join; a seam is joined one piece at a time.";
    }
    return {
      help,
      ...(positional[0] === undefined ? {} : { roleA: positional[0] }),
      joinId,
      ...(side === undefined ? {} : { side }),
      ...(pathRef === undefined ? {} : { pathRef }),
      ...(toRoles === undefined ? {} : { toRoles }),
      ...(bandSide === undefined ? {} : { bandSide }),
      ...(neighbourSide === undefined ? {} : { neighbourSide }),
      ...(id === undefined ? {} : { id }),
      ...(type === undefined ? {} : { type }),
      ...(notchCount === undefined ? {} : { notchCount }),
      ...(pathRefA === undefined ? {} : { pathRefA }),
      ...(pathRefB === undefined ? {} : { pathRefB })
    };
  }

  if (side !== undefined) {
    return "--side is only for --join (joining an existing seam). In band mode use --band-side / --neighbour-side.";
  }

  if (pathRef !== undefined) {
    return "--path-ref is only for --join; the pairwise form uses --path-ref-a / --path-ref-b.";
  }

  // band モード(--to あり): positional は band role 1つだけ。neighbours は --to の後続で受けている。
  if (toRoles !== undefined) {
    const bandRole = positional[0];
    if (bandRole === undefined) {
      return "Expected a band part role before --to.";
    }
    if (positional.length > 1) {
      return "In band mode, give exactly one band role before --to; list the neighbours after --to.";
    }
    return {
      help,
      roleA: bandRole,
      toRoles,
      ...(bandSide === undefined ? {} : { bandSide }),
      ...(neighbourSide === undefined ? {} : { neighbourSide }),
      ...(id === undefined ? {} : { id }),
      ...(type === undefined ? {} : { type }),
      ...(notchCount === undefined ? {} : { notchCount }),
      ...(pathRefA === undefined ? {} : { pathRefA }),
      ...(pathRefB === undefined ? {} : { pathRefB })
    };
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
