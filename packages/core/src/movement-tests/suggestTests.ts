import { createDiagnosticReport } from "../diagnostics/report.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { DiagnosticReport } from "../diagnostics/report.js";
import type { ResolvedProject } from "../project/resolveParts.js";
import type { PrototypeNotes } from "../schema/prototype-notes.schema.js";
import {
  createTestSuggestionRuleRegistry,
  runTestSuggestionRules
} from "./suggestionRules.js";
import type {
  TestSuggestionCandidate,
  TestSuggestionRule,
  TestSuggestionRuleRegistry
} from "./suggestionRules.js";
import type { ExclusiveRuleOptions } from "../ruleOptions.js";

export type TestSuggestionLevel = "recommended" | "optional" | "skipped";
export type TestSuggestionSource = "rule" | "prototype-note" | "project-test-suite";

export interface TestSuggestion {
  readonly scenario: string;
  readonly reason: string;
  readonly source: TestSuggestionSource;
  readonly noteId?: string;
}

export interface TestSuggestionReport extends DiagnosticReport {
  readonly recommended: readonly TestSuggestion[];
  readonly optional: readonly TestSuggestion[];
  readonly skipped: readonly TestSuggestion[];
}

export type SuggestTestsOptions = {
  readonly prototypeNotes?: PrototypeNotes;
} & ExclusiveRuleOptions<TestSuggestionRuleRegistry, TestSuggestionRule>;

const levelRank: Record<TestSuggestionLevel, number> = {
  skipped: 0,
  optional: 1,
  recommended: 2
};

const sourceRank: Record<TestSuggestionSource, number> = {
  rule: 0,
  "prototype-note": 1,
  "project-test-suite": 2
};

export function suggestTests(
  resolvedProject: ResolvedProject,
  options: SuggestTestsOptions = {}
): TestSuggestionReport {
  const tags = collectProjectTags(resolvedProject);
  const registry = options.registry ?? createTestSuggestionRuleRegistry(options.rules);
  const suggestions = runTestSuggestionRules(
    {
      resolvedProject,
      tags,
      ...(options.prototypeNotes === undefined ? {} : { prototypeNotes: options.prototypeNotes })
    },
    registry
  );
  const mergedSuggestions = applyIgnoredTests(
    mergeSuggestions(suggestions),
    resolvedProject.project.test_suite?.ignored ?? {}
  );

  return createTestSuggestionReport({
    recommended: filterSuggestionLevel(mergedSuggestions, "recommended"),
    optional: filterSuggestionLevel(mergedSuggestions, "optional"),
    skipped: filterSuggestionLevel(mergedSuggestions, "skipped")
  });
}

export function createTestSuggestionReport(input: {
  readonly diagnostics?: readonly Diagnostic[];
  readonly recommended?: readonly TestSuggestion[];
  readonly optional?: readonly TestSuggestion[];
  readonly skipped?: readonly TestSuggestion[];
} = {}): TestSuggestionReport {
  const report = createDiagnosticReport(input.diagnostics ?? []);

  return {
    ...report,
    recommended: input.recommended ?? [],
    optional: input.optional ?? [],
    skipped: input.skipped ?? []
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

function mergeSuggestions(
  suggestions: readonly TestSuggestionCandidate[]
): readonly TestSuggestionCandidate[] {
  const byScenario = new Map<string, TestSuggestionCandidate>();

  for (const suggestion of suggestions) {
    const existingSuggestion = byScenario.get(suggestion.scenario);

    if (
      existingSuggestion === undefined ||
      shouldReplaceSuggestion(existingSuggestion, suggestion)
    ) {
      byScenario.set(suggestion.scenario, suggestion);
    }
  }

  return [...byScenario.values()].sort((left, right) =>
    left.scenario.localeCompare(right.scenario)
  );
}

function shouldReplaceSuggestion(
  existingSuggestion: TestSuggestionCandidate,
  nextSuggestion: TestSuggestionCandidate
): boolean {
  const existingLevelRank = levelRank[existingSuggestion.level];
  const nextLevelRank = levelRank[nextSuggestion.level];

  if (nextLevelRank !== existingLevelRank) {
    return nextLevelRank > existingLevelRank;
  }

  return sourceRank[nextSuggestion.source] > sourceRank[existingSuggestion.source];
}

function applyIgnoredTests(
  suggestions: readonly TestSuggestionCandidate[],
  ignored: NonNullable<ResolvedProject["project"]["test_suite"]>["ignored"]
): readonly TestSuggestionCandidate[] {
  const ignoredSuggestions = Object.entries(ignored ?? {}).map(([scenario, ignoredTest]) => ({
    level: "skipped" as const,
    scenario,
    reason: ignoredTest.reason,
    source: "project-test-suite" as const
  }));
  const keptSuggestions = suggestions.filter((suggestion) => ignored?.[suggestion.scenario] === undefined);

  return mergeSuggestions([...keptSuggestions, ...ignoredSuggestions]);
}

function filterSuggestionLevel(
  suggestions: readonly TestSuggestionCandidate[],
  level: TestSuggestionLevel
): readonly TestSuggestion[] {
  return suggestions
    .filter((suggestion) => suggestion.level === level)
    .map(toTestSuggestion);
}

function toTestSuggestion(suggestion: TestSuggestionCandidate): TestSuggestion {
  return {
    scenario: suggestion.scenario,
    reason: suggestion.reason,
    source: suggestion.source,
    ...(suggestion.noteId === undefined ? {} : { noteId: suggestion.noteId })
  };
}
