import type { ResolvedProject } from "../project/resolveParts.js";
import type { PrototypeNotes } from "../schema/prototype-notes.schema.js";
import type { TestSuggestion, TestSuggestionLevel } from "./suggestTests.js";

export interface TestSuggestionCandidate extends TestSuggestion {
  readonly level: TestSuggestionLevel;
}

export interface TestSuggestionRuleContext {
  readonly resolvedProject: ResolvedProject;
  readonly tags: ReadonlySet<string>;
  readonly prototypeNotes?: PrototypeNotes;
}

export interface TestSuggestionRule {
  readonly id: string;
  readonly description: string;
  readonly suggest: (context: TestSuggestionRuleContext) => readonly TestSuggestionCandidate[];
}

export interface TestSuggestionRuleRegistry {
  readonly rules: readonly TestSuggestionRule[];
}

export const armRaiseSuggestionRule: TestSuggestionRule = {
  id: "arm-raise",
  description: "Suggests arm raise checks for sleeved blouses.",
  suggest: (context) => {
    const hasSleeve = context.resolvedProject.parts.sleeve !== undefined;

    if (
      context.resolvedProject.project.garment === "blouse" &&
      hasSleeve &&
      context.tags.has("fitted-armhole")
    ) {
      return [
        {
          level: "recommended",
          scenario: "arm-raise",
          reason: "blouse + sleeve + fitted-armhole should check shoulder and arm movement.",
          source: "rule"
        }
      ];
    }

    if (context.resolvedProject.project.garment === "blouse" && hasSleeve) {
      return [
        {
          level: "optional",
          scenario: "arm-raise",
          reason: "blouse with sleeves may need a basic arm movement check.",
          source: "rule"
        }
      ];
    }

    return [];
  }
};

export const prototypeNoteSuggestionRule: TestSuggestionRule = {
  id: "prototype-note",
  description: "Suggests movement tests from matching prototype notes.",
  suggest: (context) => {
    if (context.prototypeNotes === undefined) {
      return [];
    }

    return context.prototypeNotes.notes.flatMap((note) => {
      if (note.creates_test_case === undefined || note.applies_to === undefined) {
        return [];
      }

      if (!note.applies_to.every((tag) => context.tags.has(tag))) {
        return [];
      }

      return [
        {
          level: "recommended",
          scenario: note.creates_test_case,
          reason: `Prototype note "${note.id}" matched tags: ${note.applies_to.join(", ")}.`,
          source: "prototype-note" as const,
          noteId: note.id
        }
      ];
    });
  }
};

export const projectTestSuiteSuggestionRule: TestSuggestionRule = {
  id: "project-test-suite",
  description: "Suggests movement tests required by the project test_suite.",
  suggest: (context) =>
    (context.resolvedProject.project.test_suite?.required ?? []).map((scenario) => ({
      level: "recommended",
      scenario,
      reason: "Required by project test_suite.",
      source: "project-test-suite"
    }))
};

export const defaultTestSuggestionRules = [
  armRaiseSuggestionRule,
  prototypeNoteSuggestionRule,
  projectTestSuiteSuggestionRule
] as const;

export function createTestSuggestionRuleRegistry(
  rules: readonly TestSuggestionRule[] = defaultTestSuggestionRules
): TestSuggestionRuleRegistry {
  return {
    rules: [...rules]
  };
}

export function runTestSuggestionRules(
  context: TestSuggestionRuleContext,
  registry: TestSuggestionRuleRegistry = createTestSuggestionRuleRegistry()
): readonly TestSuggestionCandidate[] {
  return registry.rules.flatMap((rule) => rule.suggest(context));
}
