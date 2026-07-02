import { parseDocument } from "yaml";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
import type { LoadFileResult } from "./loadFileResult.js";

interface ParseYamlTextOptions {
  readonly invalidCode: string;
  readonly target: string;
}

// Intentionally returns unknown: external YAML input must be validated by a schema loader before use.
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

  // Intentionally unknown: parsed YAML is external input and is validated by Zod immediately after parsing.
  const value: unknown = document.toJSON();

  return {
    ok: true,
    value,
    diagnostics: []
  };
}
