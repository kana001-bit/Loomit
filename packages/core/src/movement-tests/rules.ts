import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { getStatusForDiagnostics } from "../diagnostics/report.js";
import type { ResolvedProject } from "../project/resolveParts.js";
import type { PrototypeNotes } from "../schema/prototype-notes.schema.js";
import type { MovementTestCheck } from "./runMovementTest.js";

export interface MovementTestRuleContext {
  readonly resolvedProject: ResolvedProject;
  readonly scenario: string;
  readonly tags: ReadonlySet<string>;
  readonly prototypeNotes?: PrototypeNotes;
}

export interface MovementTestRule {
  readonly id: string;
  readonly description: string;
  readonly check: (context: MovementTestRuleContext) => readonly MovementTestCheck[];
}

export interface MovementTestRuleRegistry {
  readonly rules: readonly MovementTestRule[];
}

export const armRaiseFittedArmholeRule: MovementTestRule = {
  id: "arm-raise.fitted-armhole",
  description: "Checks fitted sleeved blouses for arm raise movement risk.",
  check: (context) => {
    if (context.scenario !== "arm-raise") {
      return [];
    }

    const hasSleeve = context.resolvedProject.parts.sleeve !== undefined;

    if (
      context.resolvedProject.project.garment !== "blouse" ||
      !hasSleeve ||
      !context.tags.has("fitted-armhole")
    ) {
      return [];
    }

    const diagnostics = [
      createDiagnostic({
        severity: "warning",
        code: "ARM_RAISE_FITTED_ARMHOLE_RISK",
        message:
          "袖付きで袖ぐりが fitted なブラウスは、腕を上げる動作でも確認したほうがよいです。 / Fitted armholes on sleeved blouses should be checked with an arm raise test.",
        target: "arm-raise",
        suggestion: [
          "Try raising both arms and check whether the bodice lifts or the sleeve cap restricts movement."
        ]
      })
    ];

    return [
      {
        id: "arm-raise.fitted-armhole",
        status: getStatusForDiagnostics(diagnostics),
        reason: "blouse + sleeve + fitted-armhole can restrict shoulder and arm movement.",
        source: "rule",
        diagnostics
      }
    ];
  }
};

export const prototypeNoteMovementTestRule: MovementTestRule = {
  id: "prototype-note",
  description: "Turns matching prototype notes into movement test checks.",
  check: (context) => {
    if (context.prototypeNotes === undefined) {
      return [];
    }

    return context.prototypeNotes.notes.flatMap((note) => {
      if (
        note.creates_test_case !== context.scenario ||
        note.applies_to === undefined ||
        !note.applies_to.every((tag) => context.tags.has(tag))
      ) {
        return [];
      }

      const diagnostics = [
        createDiagnostic({
          severity: "warning",
          code: "MOVEMENT_TEST_PROTOTYPE_NOTE_RISK",
          message: `過去の試作ノート "${note.id}" が、この動作テストに該当しています。 / Previous prototype note "${note.id}" matched this movement test.`,
          target: note.id,
          suggestion: [note.issue]
        })
      ];

      return [
        {
          id: `${context.scenario}.prototype-note.${note.id}`,
          status: getStatusForDiagnostics(diagnostics),
          reason: `Prototype note "${note.id}" matched tags: ${note.applies_to.join(", ")}.`,
          source: "prototype-note" as const,
          diagnostics
        }
      ];
    });
  }
};

export const defaultMovementTestRules = [
  armRaiseFittedArmholeRule,
  prototypeNoteMovementTestRule
] as const;

export function createMovementTestRuleRegistry(
  rules: readonly MovementTestRule[] = defaultMovementTestRules
): MovementTestRuleRegistry {
  return {
    rules: [...rules]
  };
}

export function runMovementTestRules(
  context: MovementTestRuleContext,
  registry: MovementTestRuleRegistry = createMovementTestRuleRegistry()
): readonly MovementTestCheck[] {
  return registry.rules.flatMap((rule) => rule.check(context));
}
