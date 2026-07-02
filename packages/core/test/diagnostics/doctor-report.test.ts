import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadProject, resolveParts, runChecks } from "../../src/index.js";
import { createDoctorReport } from "../../src/diagnostics/doctorReport.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

describe("doctor report", () => {
  it("summarizes an ok check report", async () => {
    const report = createDoctorReport(await checkFixture("valid-blouse"));

    expect(report).toEqual({
      status: "ok",
      summary: "No problems found.",
      diagnostics: [],
      findings: []
    });
  });

  it("explains connector length and requirement range failures", async () => {
    const report = createDoctorReport(await checkFixture("length-mismatch"));

    expect(report.status).toBe("error");
    expect(report.summary).toBe("Found 3 problems.");
    expect(report.findings).toEqual([
      {
        code: "CONNECTOR_LENGTH_MISMATCH",
        title: "Connector Length Mismatch",
        detail:
          "body.armhole is 469mm and sleeve.armhole is 480mm. The difference is 11mm, but the allowed tolerance is 3mm.",
        target: "sleeve.armhole",
        suggestion: [
          "body.armhole and sleeve.armhole differ by 11mm; allowed tolerance is 3mm."
        ],
        source: {
          rule: "connector-length",
          from: "body.armhole",
          to: "sleeve.armhole"
        }
      },
      {
        code: "REQUIREMENT_RANGE_UNSATISFIED",
        title: "Requirement Range Unsatisfied",
        detail:
          "body.requires.sleeve.armhole.length_mm requires sleeve.armhole.length_mm to be at least 466 and at most 472, but the actual value is 480.",
        target: "sleeve.armhole.length_mm",
        suggestion: [
          "sleeve.armhole.length_mm is 480, but expected min 466, max 472."
        ],
        source: {
          rule: "requirement-range",
          from: "body.requires.sleeve.armhole.length_mm",
          to: "sleeve.armhole.length_mm"
        }
      },
      {
        code: "REQUIREMENT_RANGE_UNSATISFIED",
        title: "Requirement Range Unsatisfied",
        detail:
          "sleeve.requires.body.armhole.length_mm requires body.armhole.length_mm to be at least 477 and at most 483, but the actual value is 469.",
        target: "body.armhole.length_mm",
        suggestion: [
          "body.armhole.length_mm is 469, but expected min 477, max 483."
        ],
        source: {
          rule: "requirement-range",
          from: "sleeve.requires.body.armhole.length_mm",
          to: "body.armhole.length_mm"
        }
      }
    ]);
  });
});

async function checkFixture(fixtureName: string) {
  const loadedProject = await loadProject(join(fixturesRoot, fixtureName));

  if (!loadedProject.ok) {
    throw new Error("Expected project to load.");
  }

  const resolvedProject = await resolveParts(loadedProject.value);

  if (!resolvedProject.ok) {
    throw new Error("Expected project parts to resolve.");
  }

  return runChecks(resolvedProject.value);
}
