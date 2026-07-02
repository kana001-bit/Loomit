import { access, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";

const projectFileName = "loomit.yml";

export async function findProjectRoot(startPath: string): Promise<LoadFileResult<string>> {
  let current = await getSearchStart(startPath);

  while (true) {
    const projectFilePath = join(current, projectFileName);

    if (await canAccess(projectFilePath)) {
      return {
        ok: true,
        value: current,
        diagnostics: []
      };
    }

    const parent = dirname(current);

    if (parent === current) {
      return {
        ok: false,
        diagnostics: [
          createDiagnostic({
            severity: "error",
            code: "PROJECT_ROOT_NOT_FOUND",
            message: "loomit.yml が見つかりませんでした。/ Could not find loomit.yml.",
            target: startPath,
            suggestion: [
              "Loomit プロジェクト内で実行するか、loomit.yml の場所を確認してください。/ Run inside a Loomit project or check where loomit.yml is located."
            ]
          })
        ]
      };
    }

    current = parent;
  }
}

async function getSearchStart(startPath: string): Promise<string> {
  const resolvedPath = resolve(startPath);

  try {
    const stats = await stat(resolvedPath);

    if (stats.isFile()) {
      return dirname(resolvedPath);
    }
  } catch {
    return resolvedPath;
  }

  return resolvedPath;
}

async function canAccess(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
