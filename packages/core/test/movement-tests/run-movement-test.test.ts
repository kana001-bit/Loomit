import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runMovementTest } from "../../src/movement-tests/runMovementTest.js";
import { loadPrototypeNotesFile } from "../../src/prototype-notes/loadPrototypeNotes.js";
import { loadProject } from "../../src/project/loadProject.js";
import { resolveParts } from "../../src/project/resolveParts.js";
import type { ResolvedProject } from "../../src/project/resolveParts.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

describe("runMovementTest", () => {
  it("reports arm raise risk for fitted armhole blouses with sleeves", async () => {
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const report = runMovementTest(resolvedProject, "arm-raise");

    expect(report.status).toBe("warning");
    expect(report.diagnostics).toEqual([
      {
        severity: "warning",
        code: "ARM_RAISE_FITTED_ARMHOLE_RISK",
        message: "Fitted armholes on sleeved blouses should be checked with an arm raise test.",
        target: "arm-raise",
        suggestion: [
          "Try raising both arms and check whether the bodice lifts or the sleeve cap restricts movement."
        ]
      }
    ]);
    expect(report.checks).toEqual([
      {
        id: "arm-raise.fitted-armhole",
        status: "warning",
        reason: "blouse + sleeve + fitted-armhole can restrict shoulder and arm movement.",
        source: "rule",
        diagnostics: [
          {
            severity: "warning",
            code: "ARM_RAISE_FITTED_ARMHOLE_RISK",
            message: "Fitted armholes on sleeved blouses should be checked with an arm raise test.",
            target: "arm-raise",
            suggestion: [
              "Try raising both arms and check whether the bodice lifts or the sleeve cap restricts movement."
            ]
          }
        ]
      }
    ]);
  });

  it("includes matching prototype note risks", async () => {
    const resolvedProject = withExtraSleeveTag(await loadResolvedFixture("valid-blouse"), "non-stretch-fabric");
    const prototypeNotes = await loadPrototypeNotesFixture();
    const report = runMovementTest(resolvedProject, "arm-raise", {
      prototypeNotes
    });

    expect(report.status).toBe("warning");
    expect(report.diagnostics).toEqual([
      {
        severity: "warning",
        code: "ARM_RAISE_FITTED_ARMHOLE_RISK",
        message: "Fitted armholes on sleeved blouses should be checked with an arm raise test.",
        target: "arm-raise",
        suggestion: [
          "Try raising both arms and check whether the bodice lifts or the sleeve cap restricts movement."
        ]
      },
      {
        severity: "warning",
        code: "MOVEMENT_TEST_PROTOTYPE_NOTE_RISK",
        message: 'Previous prototype note "note-2026-06-28-armhole" matched this movement test.',
        target: "note-2026-06-28-armhole",
        suggestion: ["armhole tight when raising arms"]
      }
    ]);
    expect(report.checks).toContainEqual({
      id: "arm-raise.prototype-note.note-2026-06-28-armhole",
      status: "warning",
      reason: 'Prototype note "note-2026-06-28-armhole" matched tags: fitted-armhole, non-stretch-fabric.',
      source: "prototype-note",
      diagnostics: [
        {
          severity: "warning",
          code: "MOVEMENT_TEST_PROTOTYPE_NOTE_RISK",
          message: 'Previous prototype note "note-2026-06-28-armhole" matched this movement test.',
          target: "note-2026-06-28-armhole",
          suggestion: ["armhole tight when raising arms"]
        }
      ]
    });
  });

  it("returns an error for unsupported movement test scenarios", async () => {
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const report = runMovementTest(resolvedProject, "squat");

    expect(report).toEqual({
      status: "error",
      diagnostics: [
        {
          severity: "error",
          code: "MOVEMENT_TEST_UNSUPPORTED",
          message: 'Movement test scenario "squat" is not supported yet.',
          target: "squat",
          suggestion: ['Use a supported scenario such as "arm-raise".']
        }
      ],
      scenario: "squat",
      checks: []
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
