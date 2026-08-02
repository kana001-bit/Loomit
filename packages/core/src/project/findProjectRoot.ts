import { access, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { describeFsError, getErrno } from "../filesystem/fsError.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";

const projectFileName = "loomit.yml";

export async function findProjectRoot(startPath: string): Promise<LoadFileResult<string>> {
  let current = await getSearchStart(startPath);

  while (true) {
    const projectFilePath = join(current, projectFileName);
    const accessState = await getAccessState(projectFilePath);

    if (accessState.kind === "ok") {
      return {
        ok: true,
        value: current,
        diagnostics: []
      };
    }

    if (accessState.kind === "error") {
      return {
        ok: false,
        diagnostics: [
          describeFsError(accessState.error, {
            code: "PROJECT_ROOT_ACCESS_FAILED",
            message: "loomit.yml にアクセスできませんでした。 / Could not access loomit.yml.",
            target: projectFilePath,
            suggestion: ["Check read permissions for loomit.yml and its parent directory."]
          })
        ]
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

async function getAccessState(
  filePath: string
): Promise<
  | { readonly kind: "ok" }
  | { readonly kind: "missing" }
  | { readonly kind: "error"; readonly error: unknown }
> {
  try {
    await access(filePath);
    return { kind: "ok" };
  } catch (error) {
    return getErrno(error) === "ENOENT" ? { kind: "missing" } : { kind: "error", error };
  }
}
