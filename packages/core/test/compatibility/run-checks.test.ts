import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadProject, resolveParts, runChecks } from "../../src/index.js";
import type { ResolvedProject, ResolvedProjectPart } from "../../src/index.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

describe("runChecks", () => {
  it("returns ok connector compatibility and requirement checks for a valid project", async () => {
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const report = runChecks(resolvedProject);

    expect(report.status).toBe("ok");
    expect(report.diagnostics).toEqual([]);
    expect(report.compatibility).toEqual([
      {
        status: "ok",
        from: "body.armhole",
        to: "sleeve.armhole",
        rule: "connector-length",
        actual: {
          fromLengthMm: 469,
          toLengthMm: 470,
          differenceMm: 1
        },
        expected: {
          toleranceMm: 3
        },
        diagnostics: []
      },
      {
        status: "ok",
        from: "body.requires.sleeve.armhole.length_mm",
        to: "sleeve.armhole.length_mm",
        rule: "requirement-range",
        actual: {
          value: 470
        },
        expected: {
          min: 466,
          max: 472
        },
        diagnostics: []
      },
      {
        status: "ok",
        from: "sleeve.requires.body.armhole.length_mm",
        to: "body.armhole.length_mm",
        rule: "requirement-range",
        actual: {
          value: 469
        },
        expected: {
          min: 467,
          max: 473
        },
        diagnostics: []
      }
    ]);
  });

  it("reports connector length and requirement range mismatches", async () => {
    const resolvedProject = await loadResolvedFixture("length-mismatch");
    const report = runChecks(resolvedProject);

    expect(report.status).toBe("error");
    expect(report.diagnostics).toEqual([]);
    expect(report.compatibility).toEqual([
      {
        status: "error",
        from: "body.armhole",
        to: "sleeve.armhole",
        rule: "connector-length",
        actual: {
          fromLengthMm: 469,
          toLengthMm: 480,
          differenceMm: 11
        },
        expected: {
          toleranceMm: 3
        },
        diagnostics: [
          {
            severity: "error",
            code: "CONNECTOR_LENGTH_MISMATCH",
            message:
              "コネクタの仕上がり線の長さが許容差を超えています。/ Connector finished seam lengths exceed the tolerance.",
            target: "sleeve.armhole",
            suggestion: [
              "body.armhole and sleeve.armhole differ by 11mm; allowed tolerance is 3mm."
            ]
          }
        ]
      },
      {
        status: "error",
        from: "body.requires.sleeve.armhole.length_mm",
        to: "sleeve.armhole.length_mm",
        rule: "requirement-range",
        actual: {
          value: 480
        },
        expected: {
          min: 466,
          max: 472
        },
        diagnostics: [
          {
            severity: "error",
            code: "REQUIREMENT_RANGE_UNSATISFIED",
            message:
              "要求条件の範囲を満たしていません。/ The requirement range is not satisfied.",
            target: "sleeve.armhole.length_mm",
            suggestion: [
              "sleeve.armhole.length_mm is 480, but expected min 466, max 472."
            ]
          }
        ]
      },
      {
        status: "error",
        from: "sleeve.requires.body.armhole.length_mm",
        to: "body.armhole.length_mm",
        rule: "requirement-range",
        actual: {
          value: 469
        },
        expected: {
          min: 477,
          max: 483
        },
        diagnostics: [
          {
            severity: "error",
            code: "REQUIREMENT_RANGE_UNSATISFIED",
            message:
              "要求条件の範囲を満たしていません。/ The requirement range is not satisfied.",
            target: "body.armhole.length_mm",
            suggestion: [
              "body.armhole.length_mm is 469, but expected min 477, max 483."
            ]
          }
        ]
      }
    ]);
  });

  it("does not compare direct connector lengths with different connector ids", async () => {
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const body = getResolvedPart(resolvedProject, "body");
    const sleeve = getResolvedPart(resolvedProject, "sleeve");
    const report = runChecks({
      ...resolvedProject,
      parts: {
        body,
        sleeve: {
          ...sleeve,
          part: {
            ...sleeve.part,
            connectors: {
              cuff: {
                type: "cuff",
                length_mm: 470,
                tolerance_mm: 3
              }
            },
            requires: {}
          }
        }
      }
    });

    expect(report.compatibility).not.toContainEqual(
      expect.objectContaining({
        rule: "connector-length"
      })
    );
  });

  it("reports missing connectors referenced by requirements", async () => {
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const body = getResolvedPart(resolvedProject, "body");
    const sleeve = getResolvedPart(resolvedProject, "sleeve");
    const report = runChecks({
      ...resolvedProject,
      parts: {
        body,
        sleeve: {
          ...sleeve,
          part: {
            ...sleeve.part,
            connectors: {}
          }
        }
      }
    });

    expect(report.status).toBe("error");
    expect(report.compatibility).toContainEqual({
      status: "error",
      from: "body.requires.sleeve.armhole.length_mm",
      to: "sleeve.armhole.length_mm",
      rule: "requirement-range",
      expected: {
        min: 466,
        max: 472
      },
      diagnostics: [
        {
          severity: "error",
          code: "CONNECTOR_MISSING",
          message:
            "要求条件の参照先コネクタが見つかりません。/ Could not find the connector referenced by the requirement.",
          target: "sleeve.armhole.length_mm",
          suggestion: [
            'Add connector "armhole" to part "sleeve", or update the requirement target.'
          ]
        }
      ]
    });
  });
});

async function loadResolvedFixture(fixtureName: string): Promise<ResolvedProject> {
  const loadedProject = expectLoaded(await loadProject(join(fixturesRoot, fixtureName)));
  return expectLoaded(await resolveParts(loadedProject));
}

function expectLoaded<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) {
    throw new Error("Expected project to load.");
  }

  return result.value;
}

function getResolvedPart(
  resolvedProject: ResolvedProject,
  role: string
): ResolvedProjectPart {
  const part = resolvedProject.parts[role];

  if (part === undefined) {
    throw new Error(`Expected resolved part for role "${role}".`);
  }

  return part;
}
