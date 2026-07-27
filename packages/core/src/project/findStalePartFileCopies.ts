import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { describeFsError, getErrno } from "../filesystem/fsError.js";
import { toPosixPath } from "../filesystem/toPosixPath.js";
import type { ResolvedProject } from "./resolveParts.js";

// 設計判断: 同じ files.* の値が project root と part ディレクトリの両方に実体を持ちうる。`loom add` が
// .val を part ディレクトリへコピーし(addPartToProject)、DXF は運用手順で手コピーするため、1 つの原本が
// コピーに分かれた project が現に存在する。
//
// files.* の解決は root 相対を優先する(resolvePartFilePath)ので、両方在るときに読まれるのは root 側。
// したがってこの検出が見つけるのは「古いものを読んでいる」ではなく「**このコピーは読まれない**」状態。
// 放置すると2つの形で刺さる: (1) コピーを編集しても結果が変わらない(編集の空振り)、(2) 同名の別ファイルを
// 意図して part 側に置いていた場合、root 側が黙って勝つ。どちらも失敗として表に出ないので、検出しない
// 限り気付けない。
//
// 判定は「同じ相対パスが project root にも在って、内容が違う」という事実だけに留める。同名が偶然の
// 別ファイルである可能性は原理的に排除できないため、断定(「古いから上書きしろ」)はしない。上書きを
// 促して別ファイルだった場合、ユーザーのファイルを壊してしまう。事実だけを述べ、削除・root 側の更新・
// リネームの3通りを suggestion で案内する。
//
// コピーを作らないようにする(`loom add` の copyFile 廃止)のは別件。ここは検出のみを担う。

// 検査対象は files.* のうちパスを持つフィールド。piece は detail 名(= DXF BLOCK 名)であってパスでは
// ないため含めない。
const copiedFileFields = ["source", "preview", "geometry", "print"] as const;

export type CopiedFileField = (typeof copiedFileFields)[number];

export interface StalePartFileCopy {
  readonly role: string;
  readonly field: CopiedFileField;
  // part ディレクトリ側のコピー(絶対パス)。
  readonly copyPath: string;
  // project root 側の同名ファイル(絶対パス)。
  readonly originPath: string;
  // 診断・表示用の project 相対 posix パス。
  readonly copyRelativePath: string;
  readonly originRelativePath: string;
}

export interface StalePartFileCopyScan {
  readonly value: readonly StalePartFileCopy[];
  readonly diagnostics: readonly Diagnostic[];
}

export async function findStalePartFileCopies(
  resolvedProject: ResolvedProject
): Promise<StalePartFileCopyScan> {
  const { projectRoot } = resolvedProject.paths;
  const stale: StalePartFileCopy[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const part of Object.values(resolvedProject.parts)) {
    const files = part.part.files;

    if (files === undefined) {
      continue;
    }

    for (const field of copiedFileFields) {
      const relativeValue = files[field];

      if (relativeValue === undefined) {
        continue;
      }

      // 例外的に resolvePartFilePath を通さない。あれは「どちらか一方を選ぶ」関数だが、ここは
      // 両方を突き合わせるのが仕事なので、part 側と root 側の生パスが2つとも要る。
      const copyPath = resolve(dirname(part.filePath), relativeValue);
      const originPath = resolve(projectRoot, relativeValue);

      // part.loom が project root 直下に在る構成では両者が同一ファイルを指す。コピー関係が成立しない
      // ので比較しない(自分自身と比べて常に一致、という無意味な I/O を避ける)。
      if (copyPath === originPath) {
        continue;
      }

      if ((await compareContents(copyPath, originPath, diagnostics)) === "differs") {
        stale.push({
          role: part.role,
          field,
          copyPath,
          originPath,
          copyRelativePath: toRelativePosix(projectRoot, copyPath),
          originRelativePath: toRelativePosix(projectRoot, originPath)
        });
      }
    }
  }

  // Object.values の列挙順に依存させず、診断の並びを決定的にする。
  stale.sort(
    (a, b) => a.role.localeCompare(b.role) || a.field.localeCompare(b.field)
  );

  return { value: stale, diagnostics };
}

// 両方を読めたときだけ内容を比較する。片方が無い(ENOENT)のは正当な状態で、乖離の証拠にはならない:
// 原本を project root に置かない取り込み方(loom add <他ディレクトリ>/x.val)も、コピーがまだ無い part
// も普通に在りうる。ENOENT 以外の読み失敗は「比較できなかった」事実を warning に残す。黙って一致扱いに
// すると、権限エラーが「問題なし」に化けて検出そのものが嘘になる。
async function compareContents(
  copyPath: string,
  originPath: string,
  diagnostics: Diagnostic[]
): Promise<"same" | "differs" | "unknown"> {
  const copy = await readForComparison(copyPath, diagnostics);

  if (copy === undefined) {
    return "unknown";
  }

  const origin = await readForComparison(originPath, diagnostics);

  if (origin === undefined) {
    return "unknown";
  }

  return copy.equals(origin) ? "same" : "differs";
}

// 比較はバイト列で行う。.val は UTF-8 テキストだが .dxf も対象に含むため、文字列デコードを挟まず
// Buffer のまま突き合わせる(エンコーディング解釈で偽の一致/不一致を作らない)。
async function readForComparison(
  filePath: string,
  diagnostics: Diagnostic[]
): Promise<Buffer | undefined> {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (getErrno(error) !== "ENOENT") {
      diagnostics.push(
        createDiagnostic({
          ...describeFsError(error, {
            code: "PART_FILE_COMPARE_READ_FAILED",
            message:
              "コピー比較のためのファイルを読めませんでした(この比較は省略)。 / Could not read a file for copy comparison; this comparison was skipped.",
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
