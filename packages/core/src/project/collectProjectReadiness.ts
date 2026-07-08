import { readFile, readdir } from "node:fs/promises";
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

  // 登録済み source の内容を先読みしておく。stray がこのどれかと同一内容なら「登録済み part の複製」であり、
  // loom add で登録し直しても role の二重登録(PART_ADD_ALREADY_REGISTERED)や生成先の既存で行き止まりになる。
  // その場合だけ、add ではなく「残骸なら削除」を促す。
  const registeredByContent = await readRegisteredSourceContents(resolvedProject, projectRoot);

  for (const valPath of unregistered) {
    const relativePath = toRelativePosix(projectRoot, valPath);
    const duplicateOf = await readDuplicateSource(valPath, registeredByContent);

    diagnostics.push(
      createDiagnostic({
        severity: "warning",
        code: "UNREGISTERED_VAL_SOURCE",
        message: `未登録の .val があります: ${relativePath} / A .val under parts/ is not registered as a part: ${relativePath}`,
        target: valPath,
        suggestion:
          duplicateOf === undefined
            ? [`Register it as a part: loom add ${relativePath}`]
            : [
                `This is a copy of the already-registered ${duplicateOf}; delete it if it is a leftover.`
              ]
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

// 登録済み source の内容 → project 相対パスの map。同一内容の stray を「複製」と判定するために使う。
// 内容一致だけを複製と見なす(basename 一致だと別 part の別ファイルを誤って「削除して」と促し、取り違えで
// 消させかねないため)。読めない source は判定から外す(advisory なのでスキャンで失敗させない)。
async function readRegisteredSourceContents(
  resolvedProject: ResolvedProject,
  projectRoot: string
): Promise<ReadonlyMap<string, string>> {
  const byContent = new Map<string, string>();

  for (const part of Object.values(resolvedProject.parts)) {
    const source = part.part.files?.source;

    if (source === undefined) {
      continue;
    }

    const absolute = resolve(dirname(part.filePath), source);

    try {
      const content = await readFile(absolute, "utf8");

      if (!byContent.has(content)) {
        byContent.set(content, toRelativePosix(projectRoot, absolute));
      }
    } catch {
      // 読めない source は複製判定から外す。
    }
  }

  return byContent;
}

// stray .val が登録済み source と同一内容なら、その登録済み source の project 相対パスを返す。
// 読めない/一致しない場合は undefined(= 通常の loom add 案内にフォールバックする)。
async function readDuplicateSource(
  valPath: string,
  registeredByContent: ReadonlyMap<string, string>
): Promise<string | undefined> {
  try {
    const content = await readFile(valPath, "utf8");
    return registeredByContent.get(content);
  } catch {
    return undefined;
  }
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
