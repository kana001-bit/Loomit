import { describe, expect, it } from "vitest";

import {
  createDiagnostic,
  createDiagnosticReport,
  getStatusForDiagnostics
} from "../../src/index.js";
import type { Diagnostic } from "../../src/index.js";

describe("diagnostics", () => {
  it("keeps a diagnostic as structured data", () => {
    // 守る仕様: core の診断結果は CLI 表示文ではなく構造化された Diagnostic として保持する。
    const diagnostic = createDiagnostic({
      severity: "error",
      code: "PROJECT_SCHEMA_INVALID",
      message:
        "プロジェクトファイルの形式が正しくありません。 / The project file format is invalid.",
      target: "loomit.yml",
      suggestion: ["schema フィールドを確認してください。"]
    });

    expect(diagnostic).toEqual({
      severity: "error",
      code: "PROJECT_SCHEMA_INVALID",
      message:
        "プロジェクトファイルの形式が正しくありません。 / The project file format is invalid.",
      target: "loomit.yml",
      suggestion: ["schema フィールドを確認してください。"]
    });
  });

  it("returns ok when there are no diagnostics", () => {
    // 守る仕様: diagnostics が空なら report status は ok になる。
    expect(getStatusForDiagnostics([])).toBe("ok");
  });

  it("returns the highest severity status", () => {
    // 守る仕様: warning と error が混在する場合、report status は最も重い error になる。
    // ここで検証するのは severity の集約だけなので、code は実在するものであれば何でもよい
    // (severity と code の組み合わせは production の発行箇所とは対応しない)。
    const diagnostics: readonly Diagnostic[] = [
      {
        severity: "info",
        code: "UNREGISTERED_VAL_SOURCE",
        message: "未登録の .val があります。 / A .val is not registered as a part.",
        target: "parts/sleeve.val"
      },
      {
        severity: "warning",
        code: "PART_GEOMETRY_STALE",
        message: "DXF が .val より古いままです。 / The DXF is older than the .val.",
        target: "parts/sleeve.dxf"
      },
      {
        severity: "error",
        code: "CONNECTOR_LENGTH_MISMATCH",
        message:
          "袖ぐりの仕上がり線の長さが許容差を超えています。 / The finished armhole seam length exceeds the tolerance.",
        target: "sleeve.armhole"
      }
    ];

    expect(getStatusForDiagnostics(diagnostics)).toBe("error");
  });

  it("creates a report with derived status", () => {
    // 守る仕様: DiagnosticReport の status は渡された diagnostics から導出される。
    const report = createDiagnosticReport([
      {
        severity: "warning",
        code: "PART_GEOMETRY_STALE",
        message: "DXF が .val より古いままです。 / The DXF is older than the .val.",
        target: "parts/sleeve.dxf"
      }
    ]);

    expect(report).toEqual({
      status: "warning",
      diagnostics: [
        {
          severity: "warning",
          code: "PART_GEOMETRY_STALE",
          message: "DXF が .val より古いままです。 / The DXF is older than the .val.",
          target: "parts/sleeve.dxf"
        }
      ]
    });
  });
});
