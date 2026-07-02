import { describe, expect, it } from "vitest";

import { createCheckReport, createCompatibilityResult } from "../../src/index.js";

describe("check report", () => {
  it("returns ok when there are no diagnostics or compatibility results", () => {
    const report = createCheckReport({});

    expect(report).toEqual({
      status: "ok",
      diagnostics: [],
      compatibility: []
    });
  });

  it("derives status from nested compatibility diagnostics", () => {
    const compatibility = createCompatibilityResult({
      from: "body.armhole",
      to: "sleeve.armhole",
      rule: "connector-length",
      actual: {
        fromLengthMm: 469,
        toLengthMm: 480
      },
      expected: {
        toleranceMm: 3
      },
      diagnostics: [
        {
          severity: "error",
          code: "CONNECTOR_LENGTH_MISMATCH",
          message: "Connector lengths differ beyond tolerance.",
          target: "sleeve.armhole"
        }
      ]
    });

    const report = createCheckReport({ compatibility: [compatibility] });

    expect(compatibility.status).toBe("error");
    expect(report.status).toBe("error");
    expect(report.diagnostics).toEqual([]);
    expect(report.compatibility).toEqual([compatibility]);
  });
});
