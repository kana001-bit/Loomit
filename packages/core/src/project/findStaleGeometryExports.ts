import { stat } from "node:fs/promises";
import { relative } from "node:path";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { isCaseInsensitiveFileSystemAt } from "../filesystem/caseSensitivity.js";
import { describeFsError, getErrno } from "../filesystem/fsError.js";
import { toPosixPath } from "../filesystem/toPosixPath.js";
import { resolvePartFilePath } from "../parts/resolvePartFilePath.js";
import type { ResolvedProject } from "./resolveParts.js";

// 設計判断: `.val`(製図の原本)と DXF(そこから書き出した幾何)は別ファイルで、書き出しは Valentina 側の手作業。
// つまり「`.val` を直したが DXF を書き出し直していない」状態が普通に起きる。そして**失敗として表に出ない** ──
// `loom slnt check` は古い DXF を測って古い数値を自信満々に返し、`loom check` は何も言わない。
// (実際に踏んだ: `.val` が当日更新・DXF は 3 週間前のまま waistband 680 mm を返し、diagnostics は 0 だった。)
//
// `PART_FILE_COPY_STALE` と同じ族の失敗で、違いは「原本とそのコピー」か「原本とそこから書き出した派生物」か
// だけ。あちらと同じく**断定はしない**: `.val` の編集が必ず幾何を動かすとは限らない(点の改名・ラベル移動など、
// 書き出し直しても DXF が1バイトも変わらない編集がある)。事実だけを述べ、2通りの読みを suggestion で案内する。
//
// 比較できるのは mtime だけ。Loomit は書き出しに関与しないので「この DXF がどの `.val` から出たか」を知る
// 手立ては無い(export 時のハッシュを記録できるのは書き出した側だけ)。

export interface StaleGeometryExport {
  // 診断・表示用の project 相対 posix パス。
  readonly geometryRelativePath: string;
  readonly sourceRelativePath: string;
  // 実体パス(診断の target)。
  readonly geometryPath: string;
  // source が geometry より新しい差(ミリ秒)。表示のために持つ。
  readonly staleByMs: number;
}

export interface StaleGeometryExportScan {
  readonly value: readonly StaleGeometryExport[];
  readonly diagnostics: readonly Diagnostic[];
}

// mtime の差がこれ以下なら「同時に書かれた」とみなす。単純な `geometry < source` にすると誤発火するため:
//   - `git checkout` / clone は全ファイルの mtime を操作時刻にする。書き込み順は保証されないので、
//     取り込み直後のプロジェクトで前後が付く(隣り合うファイルなのでミリ秒オーダー)。
//   - FAT / exFAT の更新時刻は 2 秒粒度(USB メモリに置いた型紙は普通にある)。量子化の端で 2 秒の差が付く。
//
// **猶予は「同一操作による書き込みのばらつき」を吸収する幅に留める。** 当初 60 秒にしていたが、これは
// 「書き出した 30 秒後に製図を直す」という**普通の操作**を見逃す ── 見逃しはこの検出が潰そうとしている
// 失敗そのもの(古い幾何を黙って測る)なので、倒す向きが逆だった。人が起こす編集は秒オーダーで起きうる一方、
// 一括書き込みのばらつきは上記2つの理由でこの幅に収まる。
//
// 残るリスク: 巨大な repo の checkout で、対象2ファイルが離れた位置にあると数秒空きうる(誤検出)。それでも
// こちらに倒す ── 誤検出の代償は「無視してよい」と自分で書いてある warning が1行出ることだけで、
// 見逃しの代償は測定値が黙って古いままになること。
const SIMULTANEOUS_TOLERANCE_MS = 2_000;

export async function findStaleGeometryExports(
  resolvedProject: ResolvedProject
): Promise<StaleGeometryExportScan> {
  const { projectRoot, projectFilePath } = resolvedProject.paths;
  const stale: StaleGeometryExport[] = [];
  const diagnostics: Diagnostic[] = [];
  // 実データでは複数 part が同じ `.val` と同じ DXF を共有する(loomitest4 は 3 part が同じ DXF)。
  // part ごとに出すと同じ事実が並ぶだけなので、ファイルの対で1回にまとめる。
  const seenPairs = new Set<string>();
  // dedupe の突き合わせは実 FS の case 感度に従う。insensitive(Windows/macOS 既定)では `body.dxf` と
  // `BODY.DXF` が同じ実体なので、綴り違いで別 part が参照していると同じ事実が2回出てしまう。逆に
  // sensitive な FS で小文字化を固定すると、大小違いの**別ファイル**を同一視して片方を握りつぶす
  // (findUnregisteredValSources と同じ方針・同じヘルパ)。
  const caseInsensitive = await isCaseInsensitiveFileSystemAt(projectFilePath);
  const normalizeKey = (path: string): string => (caseInsensitive ? path.toLowerCase() : path);

  for (const part of Object.values(resolvedProject.parts)) {
    const files = part.part.files;

    if (files?.source === undefined || files.geometry === undefined) {
      continue;
    }

    // 実際に読まれるのと同じ実体を見る(root 相対優先)。ここで解決規則がずれると、読んでいるファイルと
    // 別のファイルの新しさを報告してしまう。
    const sourcePath = resolvePartFilePath({
      partFilePath: part.filePath,
      value: files.source,
      projectRoot
    });
    const geometryPath = resolvePartFilePath({
      partFilePath: part.filePath,
      value: files.geometry,
      projectRoot
    });
    // 区切り文字を挟んだ連結にしない。パスに現れない文字を探すと結局は制御文字に行き着き、ソースに生の
    // NUL が入ってしまう(git がバイナリ判定して行差分を出せなくなる)。JSON なら曖昧さなく1本にできる。
    const pairKey = JSON.stringify([normalizeKey(geometryPath), normalizeKey(sourcePath)]);

    if (seenPairs.has(pairKey)) {
      continue;
    }

    seenPairs.add(pairKey);

    const sourceModified = await readModifiedTime(sourcePath, diagnostics);

    if (sourceModified === undefined) {
      continue;
    }

    const geometryModified = await readModifiedTime(geometryPath, diagnostics);

    if (geometryModified === undefined) {
      continue;
    }

    const staleByMs = sourceModified - geometryModified;

    if (staleByMs > SIMULTANEOUS_TOLERANCE_MS) {
      stale.push({
        geometryRelativePath: toRelativePosix(projectRoot, geometryPath),
        sourceRelativePath: toRelativePosix(projectRoot, sourcePath),
        geometryPath,
        staleByMs
      });
    }
  }

  // Object.values の列挙順に依存させず、診断の並びを決定的にする。
  stale.sort((a, b) => a.geometryRelativePath.localeCompare(b.geometryRelativePath));

  return { value: stale, diagnostics };
}

// 片方が無い(ENOENT)のは正当な状態(まだ書き出していない・`.val` を持たない part)なので黙って比較を諦める。
// ENOENT 以外の失敗は「比較できなかった」事実を warning に残す ── 黙って新しい扱いにすると、権限エラーが
// 「問題なし」に化けて検出そのものが嘘になる(findStalePartFileCopies と同じ方針)。
async function readModifiedTime(
  filePath: string,
  diagnostics: Diagnostic[]
): Promise<number | undefined> {
  try {
    return (await stat(filePath)).mtimeMs;
  } catch (error) {
    if (getErrno(error) !== "ENOENT") {
      diagnostics.push(
        createDiagnostic({
          ...describeFsError(error, {
            code: "PART_GEOMETRY_FRESHNESS_READ_FAILED",
            message:
              "更新時刻を読めなかったため、DXF が .val より古いかを判定できませんでした。 / Could not read a modification time, so Loomit could not tell whether the DXF is older than the .val.",
            target: filePath,
            suggestion: [
              "ファイルの読み取り権限を確認してください。 / Check read permissions for the file."
            ]
          }),
          severity: "warning"
        })
      );
    }

    return undefined;
  }
}

function toRelativePosix(projectRoot: string, target: string): string {
  return toPosixPath(relative(projectRoot, target));
}

// 「何日前か」を人が読める粒度で返す。正確なミリ秒より「3週間前」のほうが判断に効く。
// 猶予が 2 秒なので分未満も報告対象になる(書き出し直後に製図を直したケース)。秒の段を持たないと
// 「0 minutes 古い」という無意味な文面になる。
export function describeStaleAge(staleByMs: number): string {
  const seconds = Math.floor(staleByMs / 1_000);

  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  const days = Math.floor(hours / 24);

  return `${days} day${days === 1 ? "" : "s"}`;
}
