import { createDiagnosticReport } from "../diagnostics/report.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { DiagnosticReport } from "../diagnostics/report.js";
import type { ResolvedProject } from "../project/resolveParts.js";
import type { PrototypeNotes } from "../schema/prototype-notes.schema.js";

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

interface SuggestTestsOptions {
  readonly prototypeNotes?: PrototypeNotes;
}

interface MutableSuggestion extends TestSuggestion {
  readonly level: TestSuggestionLevel;
}

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
  const suggestions = [
    ...suggestRuleBasedTests(resolvedProject, tags),
    ...suggestPrototypeNoteTests(tags, options.prototypeNotes),
    ...suggestProjectTestSuite(resolvedProject)
  ];
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

function suggestRuleBasedTests(
  resolvedProject: ResolvedProject,
  tags: ReadonlySet<string>
): readonly MutableSuggestion[] {
  const hasSleeve = resolvedProject.parts.sleeve !== undefined;

  if (resolvedProject.project.garment === "blouse" && hasSleeve && tags.has("fitted-armhole")) {
    return [
      {
        level: "recommended",
        scenario: "arm-raise",
        reason: "blouse + sleeve + fitted-armhole should check shoulder and arm movement.",
        source: "rule"
      }
    ];
  }

  if (resolvedProject.project.garment === "blouse" && hasSleeve) {
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

function suggestPrototypeNoteTests(
  tags: ReadonlySet<string>,
  prototypeNotes: PrototypeNotes | undefined
): readonly MutableSuggestion[] {
  if (prototypeNotes === undefined) {
    return [];
  }

  return prototypeNotes.notes.flatMap((note) => {
    if (note.creates_test_case === undefined || note.applies_to === undefined) {
      return [];
    }

    if (!note.applies_to.every((tag) => tags.has(tag))) {
      return [];
    }

    return [
      {
        level: "recommended",
        scenario: note.creates_test_case,
        reason: `Prototype note "${note.id}" matched tags: ${note.applies_to.join(", ")}.`,
        source: "prototype-note",
        noteId: note.id
      }
    ];
  });
}

function suggestProjectTestSuite(resolvedProject: ResolvedProject): readonly MutableSuggestion[] {
  return (resolvedProject.project.test_suite?.required ?? []).map((scenario) => ({
    level: "recommended",
    scenario,
    reason: "Required by project test_suite.",
    source: "project-test-suite"
  }));
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
  suggestions: readonly MutableSuggestion[]
): readonly MutableSuggestion[] {
  const byScenario = new Map<string, MutableSuggestion>();

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
  existingSuggestion: MutableSuggestion,
  nextSuggestion: MutableSuggestion
): boolean {
  const existingLevelRank = levelRank[existingSuggestion.level];
  const nextLevelRank = levelRank[nextSuggestion.level];

  if (nextLevelRank !== existingLevelRank) {
    return nextLevelRank > existingLevelRank;
  }

  return sourceRank[nextSuggestion.source] > sourceRank[existingSuggestion.source];
}

function applyIgnoredTests(
  suggestions: readonly MutableSuggestion[],
  ignored: NonNullable<ResolvedProject["project"]["test_suite"]>["ignored"]
): readonly MutableSuggestion[] {
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
  suggestions: readonly MutableSuggestion[],
  level: TestSuggestionLevel
): readonly TestSuggestion[] {
  return suggestions
    .filter((suggestion) => suggestion.level === level)
    .map(toTestSuggestion);
}

function toTestSuggestion(suggestion: MutableSuggestion): TestSuggestion {
  return {
    scenario: suggestion.scenario,
    reason: suggestion.reason,
    source: suggestion.source,
    ...(suggestion.noteId === undefined ? {} : { noteId: suggestion.noteId })
  };
}
