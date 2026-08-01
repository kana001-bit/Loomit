import { parseDocument } from "yaml";

import type { RegisteredDiagnosticCode } from "../diagnostics/codes.js";
import { createDiagnostic } from "../diagnostics/diagnostic.js";
import type { LoadFileResult } from "./loadFileResult.js";

interface ParseYamlTextOptions {
  readonly invalidCode: RegisteredDiagnosticCode;
  readonly target: string;
}

// 意図的に unknown を返す: 外部の YAML 入力は、使う前に schema loader で検証する必要がある。
export function parseYamlText(
  source: string,
  options: ParseYamlTextOptions
): LoadFileResult<unknown> {
  const document = parseDocument(source, {
    prettyErrors: false
  });

  if (document.errors.length > 0) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: options.invalidCode,
          message: "YAML の形式が正しくありません。 / The YAML syntax is invalid.",
          target: options.target,
          suggestion: [
            "インデント、コロン、括弧の対応を確認してください。 / Check indentation, colons, and matching brackets."
          ]
        })
      ]
    };
  }

  // 意図的に unknown: parse した YAML は外部入力で、parse 直後に Zod で検証する。
  const value: unknown = document.toJSON();

  return {
    ok: true,
    value,
    diagnostics: []
  };
}
