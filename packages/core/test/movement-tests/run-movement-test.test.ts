import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runMovementTest } from "../../src/movement-tests/runMovementTest.js";
import { loadPrototypeNotesFile } from "../../src/prototype-notes/loadPrototypeNotes.js";
import { loadProject } from "../../src/project/loadProject.js";
import { resolveParts } from "../../src/project/resolveParts.js";
import { getStatusForDiagnostics } from "../../src/diagnostics/report.js";
import type { Diagnostic } from "../../src/diagnostics/diagnostic.js";
import type { ResolvedProject } from "../../src/project/resolveParts.js";
import type { MovementTestRule } from "../../src/movement-tests/rules.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

describe("runMovementTest", () => {
  it("reports arm raise risk for fitted armhole blouses with sleeves", async () => {
    // 守る仕様: 袖付き・fitted armhole の blouse に arm-raise をかけると ARM_RAISE_FITTED_ARMHOLE_RISK を warning で出す。
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const report = runMovementTest(resolvedProject, "arm-raise");

    expect(report.status).toBe("warning");
    expect(report.diagnostics).toEqual([
      {
        severity: "warning",
        code: "ARM_RAISE_FITTED_ARMHOLE_RISK",
        message: "袖付きで袖ぐりが fitted なブラウスは、腕を上げる動作でも確認したほうがよいです。 / Fitted armholes on sleeved blouses should be checked with an arm raise test.",
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
            message: "袖付きで袖ぐりが fitted なブラウスは、腕を上げる動作でも確認したほうがよいです。 / Fitted armholes on sleeved blouses should be checked with an arm raise test.",
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
    // 守る仕様: applies_to タグが一致する過去の prototype note は MOVEMENT_TEST_PROTOTYPE_NOTE_RISK として movement test の結果に合流する。
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
        message: "袖付きで袖ぐりが fitted なブラウスは、腕を上げる動作でも確認したほうがよいです。 / Fitted armholes on sleeved blouses should be checked with an arm raise test.",
        target: "arm-raise",
        suggestion: [
          "Try raising both arms and check whether the bodice lifts or the sleeve cap restricts movement."
        ]
      },
      {
        severity: "warning",
        code: "MOVEMENT_TEST_PROTOTYPE_NOTE_RISK",
        message: '過去の試作ノート "note-2026-06-28-armhole" が、この動作テストに該当しています。 / Previous prototype note "note-2026-06-28-armhole" matched this movement test.',
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
          message: '過去の試作ノート "note-2026-06-28-armhole" が、この動作テストに該当しています。 / Previous prototype note "note-2026-06-28-armhole" matched this movement test.',
          target: "note-2026-06-28-armhole",
          suggestion: ["armhole tight when raising arms"]
        }
      ]
    });
  });

  it("returns an error for unsupported movement test scenarios", async () => {
    // 守る仕様: 未対応シナリオ(squat)は MOVEMENT_TEST_UNSUPPORTED を error で返し、checks は空になる。
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const report = runMovementTest(resolvedProject, "squat");

    expect(report).toEqual({
      status: "error",
      diagnostics: [
        {
          severity: "error",
          code: "MOVEMENT_TEST_UNSUPPORTED",
          message: '動作テストのシナリオ "squat" にはまだ対応していません。 / Movement test scenario "squat" is not supported yet.',
          target: "squat",
          suggestion: ['Use a supported scenario such as "arm-raise".']
        }
      ],
      scenario: "squat",
      checks: []
    });
  });

  it("can run supplied movement test rules instead of the default rules", async () => {
    // 守る仕様: rules を渡すと既定ルールの代わりにその movement test ルールで検査できる(ルール差し替えの拡張点)。
    // 守る仕様: 注入した rule は Loomit の語彙に無い診断コードを X_ 接頭辞で出せる(拡張点は code まで開いている)。
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const customRule: MovementTestRule = {
      id: "arm-raise.custom-note",
      description: "Checks a custom movement note.",
      check: (context) => {
        const diagnostics: readonly Diagnostic[] = [
          {
            severity: "warning",
            code: "X_MOVEMENT_TEST_CUSTOM_NOTE",
            message: `Custom rule matched ${context.scenario}.`,
            target: context.scenario
          }
        ];

        return [
          {
            id: `${context.scenario}.custom-note`,
            status: getStatusForDiagnostics(diagnostics),
            reason: "Custom movement rule matched the project.",
            source: "rule",
            diagnostics
          }
        ];
      }
    };
    const report = runMovementTest(resolvedProject, "arm-raise", {
      rules: [customRule]
    });

    expect(report).toEqual({
      status: "warning",
      diagnostics: [
        {
          severity: "warning",
          code: "X_MOVEMENT_TEST_CUSTOM_NOTE",
          message: "Custom rule matched arm-raise.",
          target: "arm-raise"
        }
      ],
      scenario: "arm-raise",
      checks: [
        {
          id: "arm-raise.custom-note",
          status: "warning",
          reason: "Custom movement rule matched the project.",
          source: "rule",
          diagnostics: [
            {
              severity: "warning",
              code: "X_MOVEMENT_TEST_CUSTOM_NOTE",
              message: "Custom rule matched arm-raise.",
              target: "arm-raise"
            }
          ]
        }
      ]
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
