import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadPrototypeNotesFile } from "../../src/prototype-notes/loadPrototypeNotes.js";
import { loadProject } from "../../src/project/loadProject.js";
import { resolveParts } from "../../src/project/resolveParts.js";
import { suggestTests } from "../../src/movement-tests/suggestTests.js";
import type { ResolvedProject } from "../../src/project/resolveParts.js";
import type { TestSuggestionRule } from "../../src/movement-tests/suggestionRules.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

describe("suggestTests", () => {
  it("recommends arm-raise for a fitted armhole blouse with sleeves", async () => {
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const report = suggestTests(resolvedProject);

    expect(report).toEqual({
      status: "ok",
      diagnostics: [],
      recommended: [
        {
          scenario: "arm-raise",
          reason: "blouse + sleeve + fitted-armhole should check shoulder and arm movement.",
          source: "rule"
        }
      ],
      optional: [],
      skipped: []
    });
  });

  it("uses prototype notes when all applies_to tags match", async () => {
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const prototypeNotes = await loadPrototypeNotesFixture();
    const report = suggestTests(withExtraSleeveTag(resolvedProject, "non-stretch-fabric"), {
      prototypeNotes
    });

    expect(report.recommended).toContainEqual({
      scenario: "arm-raise",
      reason: 'Prototype note "note-2026-06-28-armhole" matched tags: fitted-armhole, non-stretch-fabric.',
      source: "prototype-note",
      noteId: "note-2026-06-28-armhole"
    });
  });

  it("honors ignored project test suite entries", async () => {
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const report = suggestTests({
      ...resolvedProject,
      project: {
        ...resolvedProject.project,
        test_suite: {
          ignored: {
            "arm-raise": {
              reason: "intentionally loose sleeve opening"
            }
          }
        }
      }
    });

    expect(report.recommended).toEqual([]);
    expect(report.skipped).toEqual([
      {
        scenario: "arm-raise",
        reason: "intentionally loose sleeve opening",
        source: "project-test-suite"
      }
    ]);
  });

  it("can run supplied suggestion rules instead of the default rules", async () => {
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const customRule: TestSuggestionRule = {
      id: "custom-sit",
      description: "Suggests a custom sitting test.",
      suggest: (context) => [
        {
          level: "recommended",
          scenario: "sit",
          reason: `Custom suggestion for ${context.resolvedProject.project.name}.`,
          source: "rule"
        }
      ]
    };
    const report = suggestTests(resolvedProject, {
      rules: [customRule]
    });

    expect(report).toEqual({
      status: "ok",
      diagnostics: [],
      recommended: [
        {
          scenario: "sit",
          reason: "Custom suggestion for valid-blouse.",
          source: "rule"
        }
      ],
      optional: [],
      skipped: []
    });
  });
});

async function loadResolvedFixture(fixtureName: string): Promise<ResolvedProject> {
  const loadedProject = await loadProject(join(fixturesRoot, fixtureName));

  if (!loadedProject.ok) {
    throw new Error("Expected project to load.");
  }

  const resolvedProject = await resolveParts(loadedProject.value);

  if (!resolvedProject.ok) {
    throw new Error("Expected project to resolve.");
  }

  return resolvedProject.value;
}

async function loadPrototypeNotesFixture() {
  const prototypeNotes = await loadPrototypeNotesFile(
    join(fixturesRoot, "prototype-notes/valid/prototype-notes.yml")
  );

  if (!prototypeNotes.ok) {
    throw new Error("Expected prototype notes to load.");
  }

  return prototypeNotes.value;
}

function withExtraSleeveTag(project: ResolvedProject, tag: string): ResolvedProject {
  const sleeve = project.parts.sleeve;

  if (sleeve === undefined) {
    throw new Error("Expected sleeve part.");
  }

  return {
    ...project,
    parts: {
      ...project.parts,
      sleeve: {
        ...sleeve,
        part: {
          ...sleeve.part,
          tags: [...(sleeve.part.tags ?? []), tag]
        }
      }
    }
  };
}
