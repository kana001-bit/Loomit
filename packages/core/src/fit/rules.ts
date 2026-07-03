import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { getStatusForDiagnostics } from "../diagnostics/report.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { ResolvedProject } from "../project/resolveParts.js";
import type { Profile, ProfileMeasurements } from "../schema/profile.schema.js";
import type { FitMeasurementResult } from "./fitReport.js";

export interface FitRule {
  readonly id: string;
  readonly description: string;
  readonly check: (
    project: ResolvedProject,
    profile: Profile
  ) => readonly FitMeasurementResult[];
}

export interface FitRuleRegistry {
  readonly rules: readonly FitRule[];
}

interface FitMeasurementRule {
  readonly id: string;
  readonly bodyMeasurementKey: keyof ProfileMeasurements;
  readonly partRole: string;
  readonly finishedMeasurementKey: string;
  readonly minimumEaseCm: number;
  readonly label: string;
}

const fitMeasurementRules: readonly FitMeasurementRule[] = [
  {
    id: "bust",
    bodyMeasurementKey: "bust_cm",
    partRole: "body",
    finishedMeasurementKey: "bust_width_mm",
    minimumEaseCm: 6,
    label: "bust"
  },
  {
    id: "waist",
    bodyMeasurementKey: "waist_cm",
    partRole: "body",
    finishedMeasurementKey: "waist_width_mm",
    minimumEaseCm: 4,
    label: "waist"
  },
  {
    id: "hip",
    bodyMeasurementKey: "hip_cm",
    partRole: "body",
    finishedMeasurementKey: "hip_width_mm",
    minimumEaseCm: 4,
    label: "hip"
  }
];

export const basicEaseFitRule: FitRule = {
  id: "basic-ease",
  description: "Checks basic bust, waist, and hip ease against finished garment measurements.",
  check: (project, profile) =>
    fitMeasurementRules
      .map((rule) => checkEase(project, profile, rule))
      .filter((result): result is FitMeasurementResult => result !== undefined)
};

export const defaultFitRules = [basicEaseFitRule] as const;

export function createFitRuleRegistry(
  rules: readonly FitRule[] = defaultFitRules
): FitRuleRegistry {
  return {
    rules: [...rules]
  };
}

export function runFitRules(
  project: ResolvedProject,
  profile: Profile,
  registry: FitRuleRegistry = createFitRuleRegistry()
): readonly FitMeasurementResult[] {
  return registry.rules.flatMap((rule) => rule.check(project, profile));
}

function checkEase(
  project: ResolvedProject,
  profile: Profile,
  rule: FitMeasurementRule
): FitMeasurementResult | undefined {
  const bodyMeasurementCm = profile.measurements[rule.bodyMeasurementKey];
  const part = project.parts[rule.partRole];
  const garmentWidthMm = part?.part.measurements?.finished?.[rule.finishedMeasurementKey];

  if (bodyMeasurementCm === undefined || garmentWidthMm === undefined || part === undefined) {
    return undefined;
  }

  const garmentMeasurementCm = (garmentWidthMm * 2) / 10;
  const easeCm = roundToOneDecimal(garmentMeasurementCm - bodyMeasurementCm);
  const diagnostics = createEaseDiagnostics(easeCm, rule, {
    bodyMeasurementCm,
    garmentMeasurementCm
  });

  return {
    id: rule.id,
    status: getStatusForDiagnostics(diagnostics),
    bodyMeasurementCm,
    garmentMeasurementCm,
    easeCm,
    source: {
      partRole: part.role,
      measurement: `measurements.finished.${rule.finishedMeasurementKey}`
    },
    diagnostics
  };
}

function createEaseDiagnostics(
  easeCm: number,
  rule: FitMeasurementRule,
  context: {
    readonly bodyMeasurementCm: number;
    readonly garmentMeasurementCm: number;
  }
): Diagnostic[] {
  if (easeCm < 0) {
    return [
      createDiagnostic({
        severity: "error",
        code: "FIT_EASE_NEGATIVE",
        message: `Garment finished ${rule.label} is smaller than the body ${rule.label} measurement.`,
        target: `${rule.partRole}.measurements.finished.${rule.finishedMeasurementKey}`,
        suggestion: [
          `Body ${rule.label} is ${context.bodyMeasurementCm}cm, garment ${rule.label} is ${context.garmentMeasurementCm}cm, ease is ${easeCm}cm.`
        ]
      })
    ];
  }

  if (easeCm < rule.minimumEaseCm) {
    return [
      createDiagnostic({
        severity: "warning",
        code: "FIT_EASE_LOW",
        message: `Garment finished ${rule.label} ease is low.`,
        target: `${rule.partRole}.measurements.finished.${rule.finishedMeasurementKey}`,
        suggestion: [
          `Body ${rule.label} is ${context.bodyMeasurementCm}cm, garment ${rule.label} is ${context.garmentMeasurementCm}cm, ease is ${easeCm}cm; suggested minimum is ${rule.minimumEaseCm}cm.`
        ]
      })
    ];
  }

  return [];
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}
