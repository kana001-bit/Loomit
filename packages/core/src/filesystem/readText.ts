import { readFile } from "node:fs/promises";

import { describeFsError } from "./fsError.js";
import type { LoadFileResult } from "./loadFileResult.js";

export async function readText(filePath: string): Promise<LoadFileResult<string>> {
  try {
    const text = await readFile(filePath, "utf8");

    return {
      ok: true,
      value: text,
      diagnostics: []
    };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        describeFsError(error, {
          code: "FILE_READ_FAILED",
          message: "ファイルを読み込めませんでした。 / Could not read the file.",
          target: filePath,
          suggestion: ["パスとアクセス権限を確認してください。 / Check the path and permissions."]
        })
      ]
    };
  }
}
