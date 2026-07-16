import { describe, expect, it } from "vitest";

import { createCheckReport, createCompatibilityResult } from "../../src/index.js";

describe("check report", () => {
  it("returns ok when there are no diagnostics or compatibility results", () => {
    // 守る仕様: 診断も compatibility 結果も無い check は status:"ok" で、diagnostics/compatibility ともに空配列になる。
    const report = createCheckReport({});

    expect(report).toEqual({
      status: "ok",
      diagnostics: [],
      compatibility: []
    });
  });

  it("derives status from nested compatibility diagnostics", () => {
    // 守る仕様: report の status は入れ子の compatibility 結果の診断から導く。error を含む結果があれば report も error になり、トップレベル diagnostics は空のまま。
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
