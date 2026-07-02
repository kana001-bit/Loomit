import type { z, ZodIssue } from "zod";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";

interface ValidateSchemaOptions {
  readonly invalidCode: string;
  readonly invalidMessage: string;
  readonly target: string;
}

export function validateSchema<T>(
  schema: z.ZodType<T>,
  // Intentionally unknown: external YAML input is validated by the provided Zod schema before use.
  input: unknown,
  options: ValidateSchemaOptions
): LoadFileResult<T> {
  const result = schema.safeParse(input);

  if (result.success) {
    return {
      ok: true,
      value: result.data,
      diagnostics: []
    };
  }

  const issuePaths = result.error.issues
    .map((issue) => formatIssuePath(issue))
    .filter((path, index, paths) => paths.indexOf(path) === index)
    .slice(0, 3);

  return {
    ok: false,
    diagnostics: [
      createDiagnostic({
        severity: "error",
        code: options.invalidCode,
        message: options.invalidMessage,
        target: options.target,
        suggestion:
          issuePaths.length > 0
            ? issuePaths.map((path) => `問題の場所: ${path} / Problem path: ${path}`)
            : [
                "schema と必須フィールドを確認してください。 / Check the schema and required fields."
              ]
      })
    ]
  };
}

function formatIssuePath(issue: ZodIssue): string {
  if (issue.code === "unrecognized_keys") {
    const firstKey = issue.keys[0];

    if (firstKey !== undefined) {
      return formatPath([...issue.path, firstKey]);
    }
  }

  return formatPath(issue.path);
}

function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return "<root>";
  }

  return path.map((segment) => String(segment)).join(".");
}
