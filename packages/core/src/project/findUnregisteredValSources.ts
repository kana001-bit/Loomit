import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import { resolvePartFilePath } from "../parts/resolvePartFilePath.js";
import { createDiagnostic } from "../diagnostics/diagnostic.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { isCaseInsensitiveFileSystemAt } from "../filesystem/caseSensitivity.js";
import { describeFsError, getErrno } from "../filesystem/fsError.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";
import type { ResolvedProject } from "./resolveParts.js";

// 「まだ取り込まれていない .val」の正本定義。check(UNREGISTERED_VAL_SOURCE)と loom add の引数省略
// (自動発見)がこの1実装を共有する。定義を分けると「check が add しろと案内した .val を、引数省略の
// add が見つけられない」という食い違いが起きうるため、走査・登録済み判定・残骸判定をここに集める。
//
// - 対象: parts/ 配下(再帰)の .val。includeProjectRoot 指定時は project root 直下(非再帰)も加える。
//   root 直下を見るのは add の発見だけ: 初回 add は root に .val を置く導線が普通にある一方、root の
//   原本はコピー取り込み後も残る正当な状態なので、check の走査(parts/ のみ)は広げず常時警告を避ける。
// - 除外: いずれかの part の files.source が指すファイル。突き合わせは実 FS の case 感度に従う
//   (insensitive な FS では大小違いを同一視、sensitive な FS では別ファイルとして候補に出す)。
// - duplicateOf: 登録済み source と内容が同一なら、その登録済み source の project 相対パス(残骸コピーの
//   印)。add はこれが付いた候補を取り込まない(再 add しても role の二重登録で行き止まりになる)。
//
// 失敗の扱い: ENOENT(parts/ が無い等)は「正常な不在」として空扱いだが、それ以外の I/O 失敗
// (権限エラー等)を空に畳むと「.val が無い」と偽って案内してしまうため、ディレクトリ走査の失敗は
// ok:false(error)で返す。個別ファイルの内容読み失敗は候補判定を続けられるので、warning に降格して
// diagnostics に載せる(残骸判定だけがそのファイルについて省略される)。
export interface UnregisteredValSource {
  // 絶対パス。
  readonly path: string;
  // project root からの相対 posix パス(診断・表示・選択肢に使う)。
  readonly relativePath: string;
  // 登録済み source と同一内容なら、その登録済み source の project 相対パス(残骸コピーの印)。
  readonly duplicateOf?: string;
}

export async function findUnregisteredValSources(
  resolvedProject: ResolvedProject,
  options?: { readonly includeProjectRoot?: boolean }
): Promise<LoadFileResult<readonly UnregisteredValSource[]>> {
  const { projectRoot, projectFilePath } = resolvedProject.paths;
  const partsDir = resolve(projectRoot, "parts");

  const foundVals: string[] = [];

  if (options?.includeProjectRoot === true) {
    const rootScan = await listValFiles(projectRoot, false);

    if (!rootScan.ok) {
      return rootScan;
    }

    foundVals.push(...rootScan.value);
  }

  const partsScan = await listValFiles(partsDir, true);

  if (!partsScan.ok) {
    return partsScan;
  }

  foundVals.push(...partsScan.value);

  // 登録済み判定は実 FS の case 感度に従う。insensitive(Windows/macOS 既定)では大小違いの files.source
  // 参照を「未登録」と誤検出しないよう小文字化して突き合わせ、sensitive(Linux 等)ではそのまま比較する
  // (小文字化を固定すると、sensitive FS 上の大小違いの別ファイルが登録済み扱いになり永遠に発見されない)。
  const caseInsensitive = await isCaseInsensitiveFileSystemAt(projectFilePath);
  const normalizeKey = (path: string): string => (caseInsensitive ? path.toLowerCase() : path);

  const registeredSources = collectRegisteredSources(resolvedProject, normalizeKey);
  const unregistered = foundVals.filter((valPath) => !registeredSources.has(normalizeKey(valPath)));

  // 未登録が無ければ登録済み source の内容読み(残骸判定用)ごと省く。
  if (unregistered.length === 0) {
    return { ok: true, value: [], diagnostics: [] };
  }

  // 内容読みの失敗(warning 降格)をここに集める。
  const warnings: Diagnostic[] = [];
  const registeredByContent = await readRegisteredSourceContents(
    resolvedProject,
    projectRoot,
    warnings
  );
  const sources: UnregisteredValSource[] = [];

  for (const valPath of unregistered) {
    const duplicateOf = await readDuplicateSource(valPath, registeredByContent, warnings);

    sources.push({
      path: valPath,
      relativePath: toRelativePosix(projectRoot, valPath),
      ...(duplicateOf === undefined ? {} : { duplicateOf })
    });
  }

  // readdir の走査順は環境依存なので、相対パス昇順に整えて診断・選択肢の順序を決定的にする。
  sources.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  return { ok: true, value: sources, diagnostics: warnings };
}

// ディレクトリの .val を列挙する。ENOENT(ディレクトリが無い)は正常な不在=空。それ以外(権限エラー、
// parts がファイル等)は「候補なし」と区別が付かなくなるため、空に畳まず診断で失敗させる。
async function listValFiles(
  directory: string,
  recursive: boolean
): Promise<LoadFileResult<readonly string[]>> {
  try {
    const entries = await readdir(directory, { recursive, withFileTypes: true });

    return {
      ok: true,
      value: entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".val"))
        .map((entry) => resolve(entry.parentPath, entry.name)),
      diagnostics: []
    };
  } catch (error) {
    if (getErrno(error) === "ENOENT") {
      return { ok: true, value: [], diagnostics: [] };
    }

    return {
      ok: false,
      diagnostics: [
        describeFsError(error, {
          code: "VAL_SOURCE_SCAN_FAILED",
          message: ".val の走査に失敗しました。 / Could not scan for .val files.",
          target: directory,
          suggestion: [
            "ディレクトリを読めるか確認してください。 / Check that the directory is readable."
          ]
        })
      ]
    };
  }
}

// 各 part の files.source を絶対パス化した集合。キーの正規化(case 感度)は呼び手から受け取り、
// 候補側と同じ規則で突き合わせる。
function collectRegisteredSources(
  resolvedProject: ResolvedProject,
  normalizeKey: (path: string) => string
): ReadonlySet<string> {
  const { projectRoot } = resolvedProject.paths;
  const registered = new Set<string>();

  for (const part of Object.values(resolvedProject.parts)) {
    const source = part.part.files?.source;

    if (source === undefined) {
      continue;
    }

    // 設計判断: ここは「どちらを読むか」(resolvePartFilePath)ではなく「どの .val が part に主張されて
    // いるか」を集める。files.source は project root 相対とも part 相対とも解決されうるので、両方の候補
    // 位置を登録済みとして押さえる。片方だけにすると、選ばれなかった側が「未登録」に落ちて
    // `loom add <その .val>` を促し、実行すると同じ role が二重登録される。
    registered.add(normalizeKey(resolve(projectRoot, source)));
    registered.add(normalizeKey(resolve(dirname(part.filePath), source)));
  }

  return registered;
}

// 登録済み source の内容 → project 相対パスの map。同一内容の stray を「複製」と判定するために使う。
// 内容一致だけを複製と見なす(basename 一致だと別 part の別ファイルを誤って「削除して」と促し、取り違えで
// 消させかねないため)。ENOENT(source が無い)は他の診断が指摘する状態なので黙って外し、それ以外の
// 読み失敗は「このファイルの残骸判定を証明できない」を warning で残して外す(握り潰さない)。
async function readRegisteredSourceContents(
  resolvedProject: ResolvedProject,
  projectRoot: string,
  warnings: Diagnostic[]
): Promise<ReadonlyMap<string, string>> {
  const byContent = new Map<string, string>();

  for (const part of Object.values(resolvedProject.parts)) {
    const source = part.part.files?.source;

    if (source === undefined) {
      continue;
    }

    const absolute = resolvePartFilePath({
      partFilePath: part.filePath,
      value: source,
      projectRoot
    });

    try {
      const content = await readFile(absolute, "utf8");

      if (!byContent.has(content)) {
        byContent.set(content, toRelativePosix(projectRoot, absolute));
      }
    } catch (error) {
      if (getErrno(error) !== "ENOENT") {
        warnings.push(describeReadFailure(error, absolute));
      }
    }
  }

  return byContent;
}

// stray .val が登録済み source と同一内容なら、その登録済み source の project 相対パスを返す。
// 一致しない場合は undefined(= 未取り込みの候補としてそのまま扱う)。ENOENT(走査後に消えた)は
// 黙って候補に残し、下流の add が PART_ADD_SOURCE_NOT_FOUND で説明する。それ以外の読み失敗は
// warning を残して候補に残す(残骸だったとしても、add の role 二重登録ガードが書き込み前に止める)。
async function readDuplicateSource(
  valPath: string,
  registeredByContent: ReadonlyMap<string, string>,
  warnings: Diagnostic[]
): Promise<string | undefined> {
  try {
    const content = await readFile(valPath, "utf8");
    return registeredByContent.get(content);
  } catch (error) {
    if (getErrno(error) !== "ENOENT") {
      warnings.push(describeReadFailure(error, valPath));
    }

    return undefined;
  }
}

// 内容読み失敗の warning。errno 分類(describeFsError)を使いつつ、走査自体は続行できるので
// severity を warning に降格する(このファイルの残骸判定だけが省略された、という事実の通知)。
function describeReadFailure(error: unknown, target: string): Diagnostic {
  return createDiagnostic({
    ...describeFsError(error, {
      code: "VAL_SOURCE_READ_FAILED",
      message:
        "走査中にファイルを読めませんでした(残骸判定を省略)。 / Could not read a file while scanning; duplicate detection was skipped for it.",
      target
    }),
    severity: "warning"
  });
}

function toRelativePosix(projectRoot: string, target: string): string {
  return relative(projectRoot, target).split("\\").join("/");
}
