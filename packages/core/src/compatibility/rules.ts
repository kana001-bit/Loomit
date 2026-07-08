import { createDiagnostic } from "../diagnostics/diagnostic.js";
import type { ResolvedProject, ResolvedProjectPart } from "../project/resolveParts.js";
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

export const defaultCompatibilityRules = [
  connectorLengthRule,
  requirementRangeRule
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

  for (const [fromIndex, fromPart] of parts.entries()) {
    for (const toPart of parts.slice(fromIndex + 1)) {
      compatibility.push(...comparePartConnectorLengths(fromPart, toPart));
    }
  }

  return compatibility;
}

function comparePartConnectorLengths(
  fromPart: ResolvedProjectPart,
  toPart: ResolvedProjectPart
): readonly CompatibilityResult[] {
  const compatibility: CompatibilityResult[] = [];
  const fromConnectors = fromPart.part.connectors ?? {};
  const toConnectors = toPart.part.connectors ?? {};

  for (const [connectorId, fromConnector] of Object.entries(fromConnectors)) {
    const toConnector = toConnectors[connectorId];

    if (toConnector === undefined || fromConnector.type !== toConnector.type) {
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
        toleranceMm: Math.max(fromConnector.tolerance_mm ?? 0, toConnector.tolerance_mm ?? 0)
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
