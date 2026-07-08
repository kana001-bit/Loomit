import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadProject, resolveParts, runChecks } from "../../src/index.js";
import type { ResolvedProject, ResolvedProjectPart } from "../../src/index.js";
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

  it("explains an open connector join", async () => {
    const project = await resolveFixture("valid-blouse");
    const body = getPart(project, "body");
    const sleeve = getPart(project, "sleeve");
    // armhole を body だけが宣言(sleeve は別 id)→ 相手待ちの open join。
    const checkReport = runChecks({
      ...project,
      parts: {
        body: { ...body, part: { ...body.part, requires: {} } },
        sleeve: {
          ...sleeve,
          part: {
            ...sleeve.part,
            connectors: { cuff: { type: "cuff", length_mm: 200, tolerance_mm: 3 } },
            requires: {}
          }
        }
      }
    });
    const report = createDoctorReport(checkReport);

    expect(report.findings).toContainEqual({
      code: "CONNECTOR_JOIN_OPEN",
      title: "Connector Join Open",
      detail:
        "body.armhole is declared by only one part, so it has no seam partner to sew to. A connector joins two parts: add the mating part, fix a mismatched join id, or move an internal (self) seam to Seamlint.",
      target: "body.armhole",
      suggestion: [
        'Add a part that also declares connector "armhole", fix a mismatched id, or if "armhole" is an internal (self) seam, check it in Seamlint instead of declaring a connector.'
      ],
      source: {
        rule: "connector-pairing",
        from: "body.armhole",
        to: "(no mate)"
      }
    });
  });

  it("explains an over-paired connector join", async () => {
    const project = await resolveFixture("valid-blouse");
    const body = getPart(project, "body");
    const sleeve = getPart(project, "sleeve");
    // body・sleeve に加えて collar も armhole を宣言 → 3パーツ共有の over-pair。
    const collar: ResolvedProjectPart = {
      role: "collar",
      filePath: sleeve.filePath,
      part: {
        ...sleeve.part,
        type: "collar",
        connectors: { armhole: { type: "armhole", length_mm: 470, tolerance_mm: 3 } },
        requires: {}
      }
    };
    const checkReport = runChecks({
      ...project,
      parts: {
        body: { ...body, part: { ...body.part, requires: {} } },
        sleeve: { ...sleeve, part: { ...sleeve.part, requires: {} } },
        collar
      }
    });
    const report = createDoctorReport(checkReport);

    expect(report.findings).toContainEqual({
      code: "CONNECTOR_JOIN_OVERPAIRED",
      title: "Connector Join Overpaired",
      detail:
        'Connector "armhole" is declared by more than two parts (body, collar, sleeve). A connector joins exactly two parts, so Loomit cannot tell which pair should be sewn; give the extra seams distinct join ids.',
      target: "armhole",
      suggestion: [
        'Connector "armhole" is declared by 3 parts (body, collar, sleeve); a connector joins exactly two parts. Give the extra seams distinct join ids.'
      ],
      source: {
        rule: "connector-pairing",
        from: "armhole",
        to: "body, collar, sleeve"
      }
    });
  });
});

async function resolveFixture(fixtureName: string): Promise<ResolvedProject> {
  const loadedProject = await loadProject(join(fixturesRoot, fixtureName));

  if (!loadedProject.ok) {
    throw new Error("Expected project to load.");
  }

  const resolvedProject = await resolveParts(loadedProject.value);

  if (!resolvedProject.ok) {
    throw new Error("Expected project parts to resolve.");
  }

  return resolvedProject.value;
}

function getPart(project: ResolvedProject, role: string): ResolvedProjectPart {
  const part = project.parts[role];

  if (part === undefined) {
    throw new Error(`Expected resolved part for role "${role}".`);
  }

  return part;
}

async function checkFixture(fixtureName: string) {
  return runChecks(await resolveFixture(fixtureName));
}
