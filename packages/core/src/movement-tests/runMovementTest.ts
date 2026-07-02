import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { createDiagnosticReport, getStatusForDiagnostics } from "../diagnostics/report.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { DiagnosticReport, ReportStatus } from "../diagnostics/report.js";
import type { ResolvedProject } from "../project/resolveParts.js";
import type { PrototypeNotes } from "../schema/prototype-notes.schema.js";

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

interface RunMovementTestOptions {
  readonly prototypeNotes?: PrototypeNotes;
}

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
  const checks = [
    checkArmRaiseFittedArmhole(resolvedProject, tags),
    ...checkPrototypeNotes(scenario, tags, options.prototypeNotes)
  ].filter((check): check is MovementTestCheck => check !== undefined);

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

function checkArmRaiseFittedArmhole(
  resolvedProject: ResolvedProject,
  tags: ReadonlySet<string>
): MovementTestCheck | undefined {
  const hasSleeve = resolvedProject.parts.sleeve !== undefined;

  if (resolvedProject.project.garment !== "blouse" || !hasSleeve || !tags.has("fitted-armhole")) {
    return undefined;
  }

  const diagnostics = [
    createDiagnostic({
      severity: "warning",
      code: "ARM_RAISE_FITTED_ARMHOLE_RISK",
      message: "Fitted armholes on sleeved blouses should be checked with an arm raise test.",
      target: "arm-raise",
      suggestion: ["Try raising both arms and check whether the bodice lifts or the sleeve cap restricts movement."]
    })
  ];

  return {
    id: "arm-raise.fitted-armhole",
    status: getStatusForDiagnostics(diagnostics),
    reason: "blouse + sleeve + fitted-armhole can restrict shoulder and arm movement.",
    source: "rule",
    diagnostics
  };
}

function checkPrototypeNotes(
  scenario: string,
  tags: ReadonlySet<string>,
  prototypeNotes: PrototypeNotes | undefined
): readonly MovementTestCheck[] {
  if (prototypeNotes === undefined) {
    return [];
  }

  return prototypeNotes.notes.flatMap((note) => {
    if (
      note.creates_test_case !== scenario ||
      note.applies_to === undefined ||
      !note.applies_to.every((tag) => tags.has(tag))
    ) {
      return [];
    }

    const diagnostics = [
      createDiagnostic({
        severity: "warning",
        code: "MOVEMENT_TEST_PROTOTYPE_NOTE_RISK",
        message: `Previous prototype note "${note.id}" matched this movement test.`,
        target: note.id,
        suggestion: [note.issue]
      })
    ];

    return [
      {
        id: `${scenario}.prototype-note.${note.id}`,
        status: getStatusForDiagnostics(diagnostics),
        reason: `Prototype note "${note.id}" matched tags: ${note.applies_to.join(", ")}.`,
        source: "prototype-note" as const,
        diagnostics
      }
    ];
  });
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
