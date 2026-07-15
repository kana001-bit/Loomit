import { createDiagnostic } from "../diagnostics/diagnostic.js";
import type { ResolvedProject, ResolvedProjectPart } from "../project/resolveParts.js";
import { classifyJoinSides } from "../schema/connectorSides.js";
import { resolveJoinedConnectorToleranceMm } from "../schema/connectorTolerance.js";
import type { Connector, Requirement } from "../schema/part.schema.js";
import { createCompatibilityResult } from "./checkReport.js";
import type { CompatibilityResult } from "./checkReport.js";

export interface CompatibilityRule {
  readonly id: string;
  readonly description: string;
  readonly check: (resolvedProject: ResolvedProject) => readonly CompatibilityResult[];
}

export interface CompatibilityRuleRegistry {
  readonly rules: readonly CompatibilityRule[];
}

export const connectorLengthRule: CompatibilityRule = {
  id: "connector-length",
  description: "Checks matching connector finished seam lengths within tolerance.",
  check: checkConnectorLengths
};

export const requirementRangeRule: CompatibilityRule = {
  id: "requirement-range",
  description: "Checks declared connector requirements against resolved project parts.",
  check: checkRequirements
};

// connector は縫い目に沿って縫い合う複数パーツの cross-part join(重ねの N 枚 / 連続する2側でよく、「2枚」に限らない)。
// 長さや requirement を比べる前段として、「join が graph として健全か(相手が居るか・side が2側までか)」は宣言だけで
// 判定できる。これを独立ルールにする。
// 自己シーム(同一パーツ内の縫い目)は connector で表さない設計(幾何は Seamlint 側)なので、相手の居ない
// open join は「相手待ち / id の取り違え / 自己シームの connector 誤登録」を促す warning にする。
export const connectorPairingRule: CompatibilityRule = {
  id: "connector-pairing",
  description:
    "Checks that each connector join is a sound assembly seam (has a mate; contiguous seams declare exactly two sides).",
  check: checkConnectorPairing
};

export const defaultCompatibilityRules = [
  connectorLengthRule,
  requirementRangeRule,
  connectorPairingRule
] as const;

export function createCompatibilityRuleRegistry(
  rules: readonly CompatibilityRule[] = defaultCompatibilityRules
): CompatibilityRuleRegistry {
  return {
    rules: [...rules]
  };
}

export function runCompatibilityRules(
  resolvedProject: ResolvedProject,
  registry: CompatibilityRuleRegistry = createCompatibilityRuleRegistry()
): readonly CompatibilityResult[] {
  return registry.rules.flatMap((rule) => rule.check(resolvedProject));
}

function checkConnectorLengths(resolvedProject: ResolvedProject): readonly CompatibilityResult[] {
  const compatibility: CompatibilityResult[] = [];
  const parts = Object.values(resolvedProject.parts);
  // pairwise(2枚)でない縫い目は、宣言 length_mm の 2者比較では測れない。3枚以上の重ねや contiguous(和で合う)は
  // 長さの実測を Seamlint に defer するので、ここでは長さ比較を打ち切る(任意の組の [ok] が混ざるのを防ぐ)。
  const nonPairwiseJoinIds = collectNonPairwiseJoinIds(resolvedProject);

  for (const [fromIndex, fromPart] of parts.entries()) {
    for (const toPart of parts.slice(fromIndex + 1)) {
      compatibility.push(...comparePartConnectorLengths(fromPart, toPart, nonPairwiseJoinIds));
    }
  }

  return compatibility;
}

function comparePartConnectorLengths(
  fromPart: ResolvedProjectPart,
  toPart: ResolvedProjectPart,
  nonPairwiseJoinIds: ReadonlySet<string>
): readonly CompatibilityResult[] {
  const compatibility: CompatibilityResult[] = [];
  const fromConnectors = fromPart.part.connectors ?? {};
  const toConnectors = toPart.part.connectors ?? {};

  for (const [connectorId, fromConnector] of Object.entries(fromConnectors)) {
    const toConnector = toConnectors[connectorId];

    if (toConnector === undefined || fromConnector.type !== toConnector.type) {
      continue;
    }

    // pairwise でない縫い目(3枚以上の重ね / contiguous)は相手が一意に定まらないため pairwise 長さ比較しない
    // (長さの実測は Seamlint に defer)。
    if (nonPairwiseJoinIds.has(connectorId)) {
      continue;
    }

    const fromLengthMm = fromConnector.length_mm;
    const toLengthMm = toConnector.length_mm;

    // どちらかが未測定(length_mm 無し)なら長さを比較できない。0 とみなして差分を計算すると
    // 偽の一致/不一致(NaN 比較)になるため、比較を試みず「接続整合を未確認」の warning に振り替える。
    // 幾何の実測は Seamlint(loom slnt check)、宣言値なら手で埋める前提(A案: 測定は Loomit の外・Truer は補正役)。
    if (fromLengthMm === undefined || toLengthMm === undefined) {
      compatibility.push(
        buildUnmeasuredConnectorResult({ connectorId, fromPart, fromConnector, toPart, toConnector })
      );
      continue;
    }

    compatibility.push(
      compareConnectorLength({
        connectorId,
        fromPart,
        fromLengthMm,
        toPart,
        toLengthMm,
        toleranceMm: resolveJoinedConnectorToleranceMm(fromConnector, toConnector) ?? 0
      })
    );
  }

  return compatibility;
}

function compareConnectorLength(input: {
  readonly connectorId: string;
  readonly fromPart: ResolvedProjectPart;
  readonly fromLengthMm: number;
  readonly toPart: ResolvedProjectPart;
  readonly toLengthMm: number;
  readonly toleranceMm: number;
}): CompatibilityResult {
  const differenceMm = Math.abs(input.fromLengthMm - input.toLengthMm);
  const toleranceMm = input.toleranceMm;
  const fromTarget = `${input.fromPart.role}.${input.connectorId}`;
  const toTarget = `${input.toPart.role}.${input.connectorId}`;
  const diagnostics =
    differenceMm <= toleranceMm
      ? []
      : [
          createDiagnostic({
            severity: "error",
            code: "CONNECTOR_LENGTH_MISMATCH",
            message:
              "コネクタの仕上がり線の長さが許容差を超えています。/ Connector finished seam lengths exceed the tolerance.",
            target: toTarget,
            suggestion: [
              `${fromTarget} and ${toTarget} differ by ${differenceMm}mm; allowed tolerance is ${toleranceMm}mm.`
            ]
          })
        ];

  return createCompatibilityResult({
    from: fromTarget,
    to: toTarget,
    rule: "connector-length",
    actual: {
      fromLengthMm: input.fromLengthMm,
      toLengthMm: input.toLengthMm,
      differenceMm
    },
    expected: {
      toleranceMm
    },
    diagnostics
  });
}

// 対になる connector があるのに、どちらかの length_mm が未測定で長さ比較できないときの結果。
// 「合う/合わない」を断定せず、loom slnt check(Seamlint)で seam 長を実測するよう促す warning にする。
function buildUnmeasuredConnectorResult(input: {
  readonly connectorId: string;
  readonly fromPart: ResolvedProjectPart;
  readonly fromConnector: Connector;
  readonly toPart: ResolvedProjectPart;
  readonly toConnector: Connector;
}): CompatibilityResult {
  const fromTarget = `${input.fromPart.role}.${input.connectorId}`;
  const toTarget = `${input.toPart.role}.${input.connectorId}`;
  // 未測定なのがどちら側か(両方のこともある)を具体的に示す。
  const unmeasured = [
    input.fromConnector.length_mm === undefined ? fromTarget : undefined,
    input.toConnector.length_mm === undefined ? toTarget : undefined
  ].filter((target): target is string => target !== undefined);

  return createCompatibilityResult({
    from: fromTarget,
    to: toTarget,
    rule: "connector-length",
    diagnostics: [
      createDiagnostic({
        severity: "warning",
        code: "CONNECTOR_LENGTH_UNMEASURED",
        message:
          "コネクタの仕上がり線の長さが未測定のため、接続整合を確認できません。/ Connector finished seam length is unmeasured; cannot verify the seam fit.",
        target: unmeasured.join(", "),
        suggestion: [
          `Run \`loom slnt check\` to have Seamlint measure the seam, or set a declared length_mm on ${unmeasured.join(" and ")}.`
        ]
      })
    ]
  });
}

// 1つの縫い目(join id)を宣言しているパーツ1件。role と、その縫い目でどちらの側(unit)に属すかの side。
interface JoinDeclarer {
  readonly role: string;
  readonly side?: string;
}

// join id ごとに、宣言しているパーツ(role と side)を集める。connector-pairing(健全性判定)と
// connector-length(pairwise 比較の対象外判定)の両方が使う共有ヘルパ。
function collectDeclarersByJoinId(resolvedProject: ResolvedProject): Map<string, JoinDeclarer[]> {
  const byJoinId = new Map<string, JoinDeclarer[]>();

  for (const part of Object.values(resolvedProject.parts)) {
    for (const [joinId, connector] of Object.entries(part.part.connectors ?? {})) {
      const declarers = byJoinId.get(joinId) ?? [];
      declarers.push(
        connector.side === undefined
          ? { role: part.role }
          : { role: part.role, side: connector.side }
      );
      byJoinId.set(joinId, declarers);
    }
  }

  return byJoinId;
}

// pairwise(2枚)の単純な縫い目でない join の集合。connector-length はこれらの pairwise 長さ比較を打ち切る。
// 3枚以上の重ね(coincident N-ary)や、side を宣言した contiguous(和で合う)は、宣言 length_mm の pairwise
// sanity では測れず、長さの実測は Seamlint に defer するため。
function collectNonPairwiseJoinIds(resolvedProject: ResolvedProject): ReadonlySet<string> {
  const nonPairwise = new Set<string>();

  for (const [joinId, declarers] of collectDeclarersByJoinId(resolvedProject)) {
    if (declarers.length >= 3 || declarers.some((declarer) => declarer.side !== undefined)) {
      nonPairwise.add(joinId);
    }
  }

  return nonPairwise;
}

// 同じ join id を宣言しているパーツ構成で assembly グラフの健全性を判定する。
// - 1枚: 相手待ちの open join(warning)。
// - 2枚以上・side 宣言なし: coincident(重ね/pairwise)。健全(何も出さない)。「1本の縫い目=2枚」は限らず、
//   見返し/裏地/ポケット重ねのように N 枚が1本に参加してよい。長さ(全部等長か)の実測は Seamlint に defer。
// - side 宣言あり: contiguous(連続側・和で合う)。side がちょうど2なら健全＋各側の連結性を確認(warning のみ)。
//   一部だけ side 宣言(mixed)や側が1つだけは不完全(warning)。側が3つ以上は 1本の縫い目に3 unit で error。
// 旧 over-pair(3枚以上=error)は退役: あれは主に loom add の id 使い回し検出用で、それは add 側で対処済み。
// 出力は join id 昇順、role/side も昇順で安定させる。
function checkConnectorPairing(resolvedProject: ResolvedProject): readonly CompatibilityResult[] {
  const results: CompatibilityResult[] = [];
  const declarersByJoinId = collectDeclarersByJoinId(resolvedProject);

  for (const [joinId, declarers] of [...declarersByJoinId.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const sortedDeclarers = [...declarers].sort((a, b) => a.role.localeCompare(b.role));

    if (sortedDeclarers.length === 1) {
      const only = sortedDeclarers[0];

      if (only !== undefined) {
        results.push(buildOpenJoinResult(joinId, only.role));
      }

      continue;
    }

    // side のトポロジは connectorSides の共有分類器で判定する(createSeamlintGeometryRequest と同じ真実を使い、
    // 判定が drift しないようにする)。
    const topology = classifyJoinSides(sortedDeclarers.map((declarer) => declarer.side));

    // side なし = coincident(重ね)。参加が何枚でも over-pair ではない。健全(無出力)。
    if (topology.kind === "coincident") {
      continue;
    }

    // contiguous(2側)は健全。各側のピースが他の縫い目で unit に繋がっているかだけ warning で見る(narrow B)。
    if (topology.kind === "contiguous") {
      results.push(...checkContiguousSideConnectivity(joinId, sortedDeclarers, declarersByJoinId));
      continue;
    }

    // 側が3つ以上 = 1本の縫い目に3つの unit は組めない。error。
    if (topology.kind === "too-many-sides") {
      results.push(buildTooManySidesResult(joinId, topology.sides));
      continue;
    }

    // 側の宣言が不完全(一部だけ side / 側が1種だけ)= warning。理由で文言を分ける。
    results.push(
      buildSidesIncompleteResult(
        joinId,
        sidesIncompleteSuggestion(joinId, sortedDeclarers, topology.reason)
      )
    );
  }

  return results;
}

// contiguous side ごとに、その側のピースが「当該 join 以外の縫い目」で互いに繋がっているかを見る。繋がって
// いなければ「unit と宣言したのに繋ぐ縫い目が無い」warning(辺は知らずグラフ到達性だけで判定＝Loomit で言える範囲)。
function checkContiguousSideConnectivity(
  joinId: string,
  declarers: readonly JoinDeclarer[],
  declarersByJoinId: ReadonlyMap<string, readonly JoinDeclarer[]>
): readonly CompatibilityResult[] {
  const results: CompatibilityResult[] = [];
  const rolesBySide = new Map<string, string[]>();

  for (const declarer of declarers) {
    if (declarer.side === undefined) {
      continue;
    }
    const roles = rolesBySide.get(declarer.side) ?? [];
    roles.push(declarer.role);
    rolesBySide.set(declarer.side, roles);
  }

  for (const [side, roles] of [...rolesBySide.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    // 1枚の側は自分で unit なので繋ぐ相手が要らない。
    if (roles.length <= 1) {
      continue;
    }
    if (rolesConnectedWithinSide(roles, joinId, declarersByJoinId)) {
      continue;
    }
    results.push(
      buildUnitDisconnectedResult(
        joinId,
        side,
        [...roles].sort((a, b) => a.localeCompare(b))
      )
    );
  }

  return results;
}

// side のピース同士が、当該 join を除く縫い目だけで互いにグラフ連結か。側内のピース間の縫い目だけを辿る
// (相手側 unit を経由した見かけの連結を数えないよう、side に属す role 同士のリンクに限る)。
function rolesConnectedWithinSide(
  sideRoles: readonly string[],
  excludeJoinId: string,
  declarersByJoinId: ReadonlyMap<string, readonly JoinDeclarer[]>
): boolean {
  const sideSet = new Set(sideRoles);
  const adjacency = new Map<string, Set<string>>();
  const link = (from: string, to: string): void => {
    const neighbors = adjacency.get(from) ?? new Set<string>();
    neighbors.add(to);
    adjacency.set(from, neighbors);
  };

  for (const [otherJoinId, otherDeclarers] of declarersByJoinId) {
    if (otherJoinId === excludeJoinId) {
      continue;
    }
    const roles = otherDeclarers
      .map((declarer) => declarer.role)
      .filter((role) => sideSet.has(role));
    for (const from of roles) {
      for (const to of roles) {
        if (from !== to) {
          link(from, to);
        }
      }
    }
  }

  const start = sideRoles[0];
  if (start === undefined) {
    return true;
  }
  const seen = new Set<string>([start]);
  const queue: string[] = [start];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!seen.has(neighbor)) {
        seen.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return sideRoles.every((role) => seen.has(role));
}

function buildOpenJoinResult(joinId: string, role: string): CompatibilityResult {
  const target = `${role}.${joinId}`;

  return createCompatibilityResult({
    from: target,
    to: "(no mate)",
    rule: "connector-pairing",
    diagnostics: [
      createDiagnostic({
        severity: "warning",
        code: "CONNECTOR_JOIN_OPEN",
        message:
          "コネクタの縫い合わせ相手がいません(1つのパーツだけが宣言)。/ Connector join has no mate; only one part declares it.",
        target,
        suggestion: [
          `Add a part that also declares connector "${joinId}", fix a mismatched id, or if "${joinId}" is an internal (self) seam, check it in Seamlint instead of declaring a connector.`
        ]
      })
    ]
  });
}

// 不完全な side 宣言の直し方文言。mixed(一部だけ side)と one-side(側が1種だけ)で分ける。
function sidesIncompleteSuggestion(
  joinId: string,
  declarers: readonly JoinDeclarer[],
  reason: "mixed" | "one-side"
): string {
  if (reason === "mixed") {
    const missing = declarers.filter((declarer) => declarer.side === undefined).map((declarer) => declarer.role);
    return `Parts ${missing.join(", ")} declare "${joinId}" without a side; give every part on a contiguous seam a side, or drop side on all to treat it as a stacked seam.`;
  }
  const side = declarers.find((declarer) => declarer.side !== undefined)?.side ?? "";
  return `Connector "${joinId}" declares only one side ("${side}"); a contiguous seam joins two sides. Declare the mating side, or remove side to treat it as a stacked seam.`;
}

// contiguous な縫い目の側の宣言が不完全(一部だけ side / 側が1つだけ)なときの warning。
function buildSidesIncompleteResult(joinId: string, suggestion: string): CompatibilityResult {
  return createCompatibilityResult({
    from: joinId,
    to: "(sides incomplete)",
    rule: "connector-pairing",
    diagnostics: [
      createDiagnostic({
        severity: "warning",
        code: "CONNECTOR_JOIN_SIDES_INCOMPLETE",
        message:
          "contiguous な縫い目の側の宣言が不完全です。/ Contiguous seam has an incomplete set of sides.",
        target: joinId,
        suggestion: [suggestion]
      })
    ]
  });
}

// 1本の縫い目に3つ以上の側が宣言されたときの error(1本の縫い目は2つの unit までしか組めない)。
function buildTooManySidesResult(joinId: string, sides: readonly string[]): CompatibilityResult {
  return createCompatibilityResult({
    from: joinId,
    to: sides.join(", "),
    rule: "connector-pairing",
    diagnostics: [
      createDiagnostic({
        severity: "error",
        code: "CONNECTOR_JOIN_TOO_MANY_SIDES",
        message:
          "1本の縫い目が3つ以上の側を繋いでいます。/ A seam joins more than two sides.",
        target: joinId,
        suggestion: [
          `Connector "${joinId}" declares ${sides.length} sides (${sides.join(", ")}); a seam joins exactly two sides. Use distinct connector ids for separate seams, or regroup the parts into two sides.`
        ]
      })
    ]
  });
}

// 「unit と宣言した側」のピースが他の縫い目で繋がっていないときの warning(narrow なグラフ連結性検査)。
function buildUnitDisconnectedResult(
  joinId: string,
  side: string,
  roles: readonly string[]
): CompatibilityResult {
  const target = `${joinId}.${side}`;

  return createCompatibilityResult({
    from: target,
    to: roles.join(", "),
    rule: "connector-pairing",
    diagnostics: [
      createDiagnostic({
        severity: "warning",
        code: "CONNECTOR_UNIT_DISCONNECTED",
        message:
          "unit と宣言した側のピースが、他の縫い目で繋がっていません。/ Parts grouped as one side are not joined into a unit by other seams.",
        target,
        suggestion: [
          `Side "${side}" of connector "${joinId}" groups ${roles.join(", ")} as one unit, but they are not connected by other seams. Declare the seams that join them, or split them across connectors.`
        ]
      })
    ]
  });
}

function checkRequirements(resolvedProject: ResolvedProject): readonly CompatibilityResult[] {
  const compatibility: CompatibilityResult[] = [];

  for (const sourcePart of Object.values(resolvedProject.parts)) {
    for (const [requirementPath, requirement] of Object.entries(sourcePart.part.requires ?? {})) {
      compatibility.push(checkRequirement(resolvedProject, sourcePart, requirementPath, requirement));
    }
  }

  return compatibility;
}

function checkRequirement(
  resolvedProject: ResolvedProject,
  sourcePart: ResolvedProjectPart,
  requirementPath: string,
  requirement: Requirement
): CompatibilityResult {
  const sourceTarget = `${sourcePart.role}.requires.${requirementPath}`;
  const parsedPath = parseConnectorRequirementPath(requirementPath);

  if (parsedPath === undefined) {
    return createCompatibilityResult({
      from: sourceTarget,
      to: requirementPath,
      rule: "requirement-range",
      expected: requirement,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "REQUIREMENT_TARGET_INVALID",
          message:
            "要求条件の参照先を解釈できません。/ Could not understand the requirement target.",
          target: sourceTarget,
          suggestion: ['Use a target path like "sleeve.armhole.length_mm".']
        })
      ]
    });
  }

  const targetPart = resolvedProject.parts[parsedPath.role];
  const resolvedTarget = `${parsedPath.role}.${parsedPath.connectorId}.${parsedPath.property}`;

  if (targetPart === undefined) {
    return createCompatibilityResult({
      from: sourceTarget,
      to: resolvedTarget,
      rule: "requirement-range",
      expected: requirement,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "REQUIREMENT_TARGET_MISSING",
          message:
            "要求条件の参照先パーツが見つかりません。/ Could not find the part referenced by the requirement.",
          target: sourceTarget,
          suggestion: [`Add project part "${parsedPath.role}", or update the requirement target.`]
        })
      ]
    });
  }

  const targetConnector = targetPart.part.connectors?.[parsedPath.connectorId];

  if (targetConnector === undefined) {
    return createCompatibilityResult({
      from: sourceTarget,
      to: resolvedTarget,
      rule: "requirement-range",
      expected: requirement,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "CONNECTOR_MISSING",
          message:
            "要求条件の参照先コネクタが見つかりません。/ Could not find the connector referenced by the requirement.",
          target: resolvedTarget,
          suggestion: [
            `Add connector "${parsedPath.connectorId}" to part "${parsedPath.role}", or update the requirement target.`
          ]
        })
      ]
    });
  }

  const actualValue = getConnectorPropertyValue(targetConnector, parsedPath.property);

  if (actualValue === undefined) {
    // length_mm を参照しているのに未測定のケースは「未対応」ではなく「未測定」を伝える。
    // property 自体は対応済みで、値が実測待ちなだけ(A案: 幾何の測定は Seamlint が担う)。
    const unmeasuredLength =
      parsedPath.property === "length_mm" && targetConnector.length_mm === undefined;

    return createCompatibilityResult({
      from: sourceTarget,
      to: resolvedTarget,
      rule: "requirement-range",
      expected: requirement,
      diagnostics: [
        unmeasuredLength
          ? createDiagnostic({
              severity: "warning",
              code: "CONNECTOR_LENGTH_UNMEASURED",
              message:
                "要求条件の参照先コネクタの length_mm が未測定のため、条件を確認できません。/ The connector referenced by the requirement has an unmeasured length_mm; cannot check the requirement.",
              target: resolvedTarget,
              suggestion: [
                `Run \`loom slnt check\` to have Seamlint measure the seam, or set a declared length_mm on ${parsedPath.role}.${parsedPath.connectorId}.`
              ]
            })
          : createDiagnostic({
              severity: "error",
              code: "REQUIREMENT_PROPERTY_UNSUPPORTED",
              message:
                "要求条件の参照先プロパティはまだ検証できません。/ The requirement target property is not supported yet.",
              target: sourceTarget,
              suggestion: ['Use a supported connector property such as "length_mm".']
            })
      ]
    });
  }

  const diagnostics = isRequirementSatisfied(actualValue, requirement)
    ? []
    : [
        createDiagnostic({
          severity: "error",
          code: "REQUIREMENT_RANGE_UNSATISFIED",
          message:
            "要求条件の範囲を満たしていません。/ The requirement range is not satisfied.",
          target: resolvedTarget,
          suggestion: [
            `${resolvedTarget} is ${String(actualValue)}, but expected ${formatRequirement(requirement)}.`
          ]
        })
      ];

  return createCompatibilityResult({
    from: sourceTarget,
    to: resolvedTarget,
    rule: "requirement-range",
    actual: {
      value: actualValue
    },
    expected: requirement,
    diagnostics
  });
}

interface ParsedConnectorRequirementPath {
  readonly role: string;
  readonly connectorId: string;
  readonly property: string;
}

function parseConnectorRequirementPath(
  requirementPath: string
): ParsedConnectorRequirementPath | undefined {
  const [role, connectorId, property, ...rest] = requirementPath.split(".");

  if (
    role === undefined ||
    connectorId === undefined ||
    property === undefined ||
    rest.length > 0
  ) {
    return undefined;
  }

  return {
    role,
    connectorId,
    property
  };
}

function getConnectorPropertyValue(
  connector: Connector,
  property: string
): string | number | boolean | undefined {
  if (property === "length_mm") {
    return connector.length_mm;
  }

  if (property === "type") {
    return connector.type;
  }

  return undefined;
}

function isRequirementSatisfied(
  actualValue: string | number | boolean,
  requirement: Requirement
): boolean {
  if (requirement.equals !== undefined && actualValue !== requirement.equals) {
    return false;
  }

  if (typeof actualValue === "number") {
    if (requirement.min !== undefined && actualValue < requirement.min) {
      return false;
    }

    if (requirement.max !== undefined && actualValue > requirement.max) {
      return false;
    }
  }

  if (typeof actualValue === "string" && requirement.includes !== undefined) {
    return requirement.includes.includes(actualValue);
  }

  return true;
}

function formatRequirement(requirement: Requirement): string {
  const parts: string[] = [];

  if (requirement.min !== undefined) {
    parts.push(`min ${requirement.min}`);
  }

  if (requirement.max !== undefined) {
    parts.push(`max ${requirement.max}`);
  }

  if (requirement.equals !== undefined) {
    parts.push(`equals ${String(requirement.equals)}`);
  }

  if (requirement.includes !== undefined) {
    parts.push(`includes ${requirement.includes.join(", ")}`);
  }

  return parts.join(", ");
}
