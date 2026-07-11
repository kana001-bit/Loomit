import { createDiagnostic } from "../diagnostics/diagnostic.js";
import type { ResolvedProject, ResolvedProjectPart } from "../project/resolveParts.js";
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

// connector は2パーツを縫い合わせる cross-part join。長さや requirement を比べる前段として、
// 「join が graph として健全か(相手が居るか・多重でないか)」は宣言だけで判定できる。これを独立ルールにする。
// 自己シーム(同一パーツ内の縫い目)は connector で表さない設計(幾何は Seamlint 側)なので、相手の居ない
// open join は「相手待ち / id の取り違え / 自己シームの connector 誤登録」を促す warning にする。
export const connectorPairingRule: CompatibilityRule = {
  id: "connector-pairing",
  description: "Checks that each connector join pairs exactly two parts.",
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
  // 3パーツ以上が宣言する over-pair な join は縫い合わせ相手が一意に定まらない。connector-pairing が
  // CONNECTOR_JOIN_OVERPAIRED で別途 error にするので、ここでは長さ比較そのものを打ち切る。
  // 打ち切らないと任意の組の [ok] connector-length が混ざり、構造的に壊れた join の診断がミスリーディングになる。
  const overPairedJoinIds = collectOverPairedJoinIds(resolvedProject);

  for (const [fromIndex, fromPart] of parts.entries()) {
    for (const toPart of parts.slice(fromIndex + 1)) {
      compatibility.push(...comparePartConnectorLengths(fromPart, toPart, overPairedJoinIds));
    }
  }

  return compatibility;
}

function comparePartConnectorLengths(
  fromPart: ResolvedProjectPart,
  toPart: ResolvedProjectPart,
  overPairedJoinIds: ReadonlySet<string>
): readonly CompatibilityResult[] {
  const compatibility: CompatibilityResult[] = [];
  const fromConnectors = fromPart.part.connectors ?? {};
  const toConnectors = toPart.part.connectors ?? {};

  for (const [connectorId, fromConnector] of Object.entries(fromConnectors)) {
    const toConnector = toConnectors[connectorId];

    if (toConnector === undefined || fromConnector.type !== toConnector.type) {
      continue;
    }

    // over-pair な join は相手が一意に定まらないため長さ比較しない(connector-pairing が error 化する)。
    if (overPairedJoinIds.has(connectorId)) {
      continue;
    }

    const fromLengthMm = fromConnector.length_mm;
    const toLengthMm = toConnector.length_mm;

    // どちらかが未測定(length_mm 無し)なら長さを比較できない。0 とみなして差分を計算すると
    // 偽の一致/不一致(NaN 比較)になるため、比較を試みず「接続整合を未確認」の warning に振り替える。
    // 値は Valentina / seamlint / truer が後で埋める前提(A案: 幾何の測定は Loomit の外)。
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
// 「合う/合わない」を断定せず、Valentina / truer で seam 長を測るよう促す warning にする。
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
          `Measure the seam length in Valentina and set length_mm on ${unmeasured.join(" and ")}.`
        ]
      })
    ]
  });
}

// join id ごとに、それを宣言しているパーツの role を集める。connector-pairing(健全性判定)と
// connector-length(over-pair の比較打ち切り)の両方が使う共有ヘルパ。
function collectRolesByJoinId(resolvedProject: ResolvedProject): Map<string, string[]> {
  const rolesByJoinId = new Map<string, string[]>();

  for (const part of Object.values(resolvedProject.parts)) {
    for (const joinId of Object.keys(part.part.connectors ?? {})) {
      const roles = rolesByJoinId.get(joinId) ?? [];
      roles.push(part.role);
      rolesByJoinId.set(joinId, roles);
    }
  }

  return rolesByJoinId;
}

// 3パーツ以上が宣言する over-pair な join id の集合。connector-length はこの join の長さ比較を打ち切る。
function collectOverPairedJoinIds(resolvedProject: ResolvedProject): ReadonlySet<string> {
  const overPaired = new Set<string>();

  for (const [joinId, roles] of collectRolesByJoinId(resolvedProject)) {
    if (roles.length >= 3) {
      overPaired.add(joinId);
    }
  }

  return overPaired;
}

// 同じ join id を宣言しているパーツ数で graph の健全性を判定する。
// N=2 は健全(縫い合わせペア)なので何も出さない。N=1 は相手待ちの open join(warning)、
// N>=3 は connector が想定する pairwise を超えた over-pair(error)。over-pair な join は
// connector-length 側でも長さ比較を打ち切る(相手が一意でないため)。出力は join id 昇順、role も昇順で安定させる。
function checkConnectorPairing(resolvedProject: ResolvedProject): readonly CompatibilityResult[] {
  const results: CompatibilityResult[] = [];

  for (const [joinId, roles] of [...collectRolesByJoinId(resolvedProject).entries()].sort(
    ([a], [b]) => a.localeCompare(b)
  )) {
    const sortedRoles = [...roles].sort((a, b) => a.localeCompare(b));

    if (sortedRoles.length === 1) {
      const role = sortedRoles[0];

      if (role !== undefined) {
        results.push(buildOpenJoinResult(joinId, role));
      }

      continue;
    }

    if (sortedRoles.length >= 3) {
      results.push(buildOverpairedJoinResult(joinId, sortedRoles));
    }
  }

  return results;
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

function buildOverpairedJoinResult(
  joinId: string,
  roles: readonly string[]
): CompatibilityResult {
  return createCompatibilityResult({
    from: joinId,
    to: roles.join(", "),
    rule: "connector-pairing",
    diagnostics: [
      createDiagnostic({
        severity: "error",
        code: "CONNECTOR_JOIN_OVERPAIRED",
        message:
          "コネクタの縫い合わせ相手が2つのパーツを超えています。/ Connector join is shared by more than two parts.",
        target: joinId,
        suggestion: [
          `Connector "${joinId}" is declared by ${roles.length} parts (${roles.join(", ")}); a connector joins exactly two parts. Give the extra seams distinct join ids.`
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
    // property 自体は対応済みで、値が .val 評価待ちなだけ(A案: 測定は Valentina / truer が担う)。
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
                `Measure the seam length in Valentina and set length_mm on ${parsedPath.role}.${parsedPath.connectorId}.`
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
