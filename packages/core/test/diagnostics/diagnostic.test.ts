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
    const diagnostics: readonly Diagnostic[] = [
      {
        severity: "info",
        code: "PROJECT_LOADED",
        message: "プロジェクトを読み込みました。 / Loaded the project."
      },
      {
        severity: "warning",
        code: "PART_DEPRECATED",
        message: "非推奨のパーツが使われています。 / A deprecated part is used.",
        target: "sleeve"
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
        code: "PART_DEPRECATED",
        message: "非推奨のパーツが使われています。 / A deprecated part is used.",
        target: "sleeve"
      }
    ]);

    expect(report).toEqual({
      status: "warning",
      diagnostics: [
        {
          severity: "warning",
          code: "PART_DEPRECATED",
          message: "非推奨のパーツが使われています。 / A deprecated part is used.",
          target: "sleeve"
        }
      ]
    });
  });
});
