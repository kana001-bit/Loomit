import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { createDiagnosticReport } from "../diagnostics/report.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { DiagnosticReport, ReportStatus } from "../diagnostics/report.js";
import type { ResolvedProject } from "../project/resolveParts.js";
import type { PrototypeNotes } from "../schema/prototype-notes.schema.js";
import {
  createMovementTestRuleRegistry,
  runMovementTestRules
} from "./rules.js";
import type { MovementTestRule, MovementTestRuleRegistry } from "./rules.js";
import type { ExclusiveRuleOptions } from "../ruleOptions.js";

export type MovementTestCheckSource = "rule" | "prototype-note";

export interface MovementTestCheck {
  readonly id: string;
  readonly status: ReportStatus;
  readonly reason: string;
  readonly source: MovementTestCheckSource;
  readonly diagnostics: readonly Diagnostic[];
}

export interface MovementTestReport extends DiagnosticReport {
  readonly scenario: string;
  readonly checks: readonly MovementTestCheck[];
}

export type RunMovementTestOptions = {
  readonly prototypeNotes?: PrototypeNotes;
} & ExclusiveRuleOptions<MovementTestRuleRegistry, MovementTestRule>;

export function runMovementTest(
  resolvedProject: ResolvedProject,
  scenario: string,
  options: RunMovementTestOptions = {}
): MovementTestReport {
  if (scenario !== "arm-raise") {
    return createMovementTestReport({
      scenario,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "MOVEMENT_TEST_UNSUPPORTED",
          message: `Movement test scenario "${scenario}" is not supported yet.`,
          target: scenario,
          suggestion: ['Use a supported scenario such as "arm-raise".']
        })
      ]
    });
  }

  const tags = collectProjectTags(resolvedProject);
  const registry = options.registry ?? createMovementTestRuleRegistry(options.rules);
  const checks = runMovementTestRules(
    {
      resolvedProject,
      scenario,
      tags,
      ...(options.prototypeNotes === undefined ? {} : { prototypeNotes: options.prototypeNotes })
    },
    registry
  );

  return createMovementTestReport({
    scenario,
    checks
  });
}

export function createMovementTestReport(input: {
  readonly scenario: string;
  readonly diagnostics?: readonly Diagnostic[];
  readonly checks?: readonly MovementTestCheck[];
}): MovementTestReport {
  const diagnostics = input.diagnostics ?? [];
  const checks = input.checks ?? [];
  const checkDiagnostics = checks.flatMap((check) => check.diagnostics);
  const reportDiagnostics = [...diagnostics, ...checkDiagnostics];
  const report = createDiagnosticReport(reportDiagnostics);

  return {
    ...report,
    scenario: input.scenario,
    checks
  };
}

function collectProjectTags(resolvedProject: ResolvedProject): ReadonlySet<string> {
  return new Set([
    resolvedProject.project.garment,
    ...Object.values(resolvedProject.parts).flatMap((part) => [
      part.role,
      part.part.type,
      ...(part.part.tags ?? [])
    ])
  ]);
}
