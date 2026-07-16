import { describe, expect, it } from "vitest";

import { parseSeamlintGeometryReport } from "../../src/index.js";

describe("parseSeamlintGeometryReport", () => {
  it("accepts a complete geometry report payload", () => {
    // 守る仕様: 完全な geometry report payload(reports と入れ子 diagnostics つき)は parse できる。
    const parsed = parseSeamlintGeometryReport(
      JSON.stringify({
        status: "ok",
        target: "geometry-request",
        diagnostics: [],
        reports: [
          {
            status: "warning",
            target: "body.armhole/sleeve.armhole",
            lengthMm: 460,
            diagnostics: [
              {
                severity: "warning",
                code: "geometry.length_warning",
                target: "body.armhole/sleeve.armhole",
                message: "close to the tolerance",
                suggestion: ["Double-check the seam allowance."]
              }
            ]
          }
        ]
      })
    );

    expect(parsed?.status).toBe("ok");
    expect(parsed?.reports[0]?.diagnostics[0]?.code).toBe("geometry.length_warning");
  });

  it("rejects a report whose nested check payload is malformed", () => {
    // 守る仕様: 入れ子の check payload が壊れている report は parse せず undefined を返す(部分的に受理しない)。
    const parsed = parseSeamlintGeometryReport(
      JSON.stringify({
        status: "ok",
        target: "geometry-request",
        diagnostics: [],
        reports: [{ status: "ok", target: "body.armhole/sleeve.armhole", lengthMm: 460 }]
      })
    );

    expect(parsed).toBeUndefined();
  });
});
