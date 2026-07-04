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

    compatibility.push(
      compareConnectorLength({
        connectorId,
        fromPart,
        fromConnector,
        toPart,
        toConnector
      })
    );
  }

  return compatibility;
}

function compareConnectorLength(input: {
  readonly connectorId: string;
  readonly fromPart: ResolvedProjectPart;
  readonly fromConnector: Connector;
  readonly toPart: ResolvedProjectPart;
  readonly toConnector: Connector;
}): CompatibilityResult {
  const differenceMm = Math.abs(input.fromConnector.length_mm - input.toConnector.length_mm);
  const toleranceMm = Math.max(
    input.fromConnector.tolerance_mm ?? 0,
    input.toConnector.tolerance_mm ?? 0
  );
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
      fromLengthMm: input.fromConnector.length_mm,
      toLengthMm: input.toConnector.length_mm,
      differenceMm
    },
    expected: {
      toleranceMm
    },
    diagnostics
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
    return createCompatibilityResult({
      from: sourceTarget,
      to: resolvedTarget,
      rule: "requirement-range",
      expected: requirement,
      diagnostics: [
        createDiagnostic({
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
