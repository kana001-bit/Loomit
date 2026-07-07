import { readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { ResolvedProject } from "./resolveParts.js";

// loom add の導入で「part を追加してからでないと意味のないコマンド」が増えた。check / build がその状況を
// 黙って ok にせず、次の一手を案内するための診断を集める。
// - part が1つも無い → error: 先に loom add する
// - parts/ 配下に、どの part の files.source にも該当しない .val がある → warning: loom add で登録する
//
// resolveParts / buildProject などの core プリミティブには入れない(空 project を扱うのは正当なため)。
// 「空は使い方の誤り」という判断は CLI コマンド層の方針として、この関数を明示的に呼ぶ場所にだけ効かせる。
export async function collectProjectReadinessDiagnostics(
  resolvedProject: ResolvedProject
): Promise<readonly Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const { projectRoot, projectFilePath } = resolvedProject.paths;
  const partsDir = resolve(projectRoot, "parts");

  const registeredSources = collectRegisteredSources(resolvedProject);
  const foundVals = await findValFiles(partsDir);
  const unregistered = foundVals.filter(
    (valPath) => !registeredSources.has(valPath.toLowerCase())
  );

  if (Object.keys(resolvedProject.parts).length === 0) {
    const firstUnregistered = unregistered[0];

    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: "PROJECT_HAS_NO_PARTS",
        message:
          "まだ part が1つも追加されていません。 / No parts have been added to this project yet.",
        target: projectFilePath,
        suggestion: [
          firstUnregistered === undefined
            ? "Add a Valentina .val as a part first: loom add <file.val>"
            : `Add one first, e.g. loom add ${toRelativePosix(projectRoot, firstUnregistered)}`
        ]
      })
    );

    // part が空なら未登録 .val はすべて「まだ add していない」ものなので、error に集約する
    // (同じことを warning で重ねて出さない)。
    return diagnostics;
  }

  for (const valPath of unregistered) {
    const relativePath = toRelativePosix(projectRoot, valPath);

    diagnostics.push(
      createDiagnostic({
        severity: "warning",
        code: "UNREGISTERED_VAL_SOURCE",
        message: `未登録の .val があります: ${relativePath} / A .val under parts/ is not registered as a part: ${relativePath}`,
        target: valPath,
        suggestion: [`Register it as a part: loom add ${relativePath}`]
      })
    );
  }

  return diagnostics;
}

// 各 part の files.source を絶対パス化した集合。大文字小文字を区別しないファイルシステム(Windows/macOS)で
// 誤って「未登録」と判定しないよう小文字化して突き合わせる。
function collectRegisteredSources(resolvedProject: ResolvedProject): ReadonlySet<string> {
  const registered = new Set<string>();

  for (const part of Object.values(resolvedProject.parts)) {
    const source = part.part.files?.source;

    if (source !== undefined) {
      registered.add(resolve(dirname(part.filePath), source).toLowerCase());
    }
  }

  return registered;
}

// parts/ 配下を再帰的に走査して .val を集める。parts/ が無い場合や読めない場合は advisory なので空で返す
// (check / build 本体をこの補助スキャンで失敗させない)。
async function findValFiles(partsDir: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(partsDir, { recursive: true, withFileTypes: true });

    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".val"))
      .map((entry) => resolve(entry.parentPath, entry.name));
  } catch {
    return [];
  }
}

function toRelativePosix(projectRoot: string, target: string): string {
  return relative(projectRoot, target).split("\\").join("/");
}
