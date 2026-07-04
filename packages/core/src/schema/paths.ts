import { isAbsolute } from "node:path";

import { z } from "zod";

import { isSafePathSegment } from "../filesystem/pathWithin.js";

// ディレクトリ名として使う単一のパスセグメント(project role, part type)。区切り文字や "." / ".."
// を拒否し、パス結合(例: join(outputDir, "parts", role, ...))のときにパスを外へ逃がしたり別の場所へ
// 向けたりできないようにする。
export const pathSegmentSchema = z.string().min(1).refine(isSafePathSegment, {
  message: "must be a single path segment without separators, '.', or '..'"
});

// project root 相対の参照パス(parts.*, profiles.*, outputs.dir, part.files.*)。絶対パスと ".."
// セグメントを拒否し、loader・build・copy が root の外のファイルを指せないようにする。
function hasParentSegment(value: string): boolean {
  return value.split(/[\\/]/).includes("..");
}

export const relativePathSchema = z
  .string()
  .min(1)
  .refine((value) => !isAbsolute(value), {
    message: "must be a project-relative path, not an absolute path"
  })
  .refine((value) => !hasParentSegment(value), {
    message: "must not escape the root with .."
  });

// 正本(source-of-truth)を保持する durable な scaffold ディレクトリ(createProject の
// scaffoldDirectories から output を除いたもの)。outputs.dir がこれらや project root と重なると、
// fork の output 除外が durable state を落としてしまうため許可しない。
const reservedDurableDirectories: readonly string[] = ["parts", "notes", "profiles"];

function normalizeRelativeDir(value: string): string {
  const segments = value
    .split(/[\\/]/)
    .filter((segment) => segment.length > 0 && segment !== ".");
  return segments.length === 0 ? "." : segments.join("/");
}

function isInsideReservedDirectory(normalized: string): boolean {
  // 大文字小文字を区別しないファイルシステム(Windows/macOS)では ./Parts と ./parts が同じ場所を
  // 指すため、reserved 判定は小文字化して比較する。
  const lower = normalized.toLowerCase();
  return reservedDurableDirectories.some(
    (reserved) => lower === reserved || lower.startsWith(`${reserved}/`)
  );
}

// outputs.dir は Loomit が管理する再生成領域(operational-constraints R6)。相対パスのルールに加えて、
// project root(".")・durable scaffold ディレクトリ・およびその配下(例: ./parts/body)であっては
// ならない。こうすることで、output を破棄可能なもの(例: fork で除外)として扱っても正本ファイルを
// 消してしまうことが決して起きないようにする。
export const outputDirSchema = relativePathSchema.refine(
  (value) => {
    const normalized = normalizeRelativeDir(value);
    return normalized !== "." && !isInsideReservedDirectory(normalized);
  },
  {
    message:
      "outputs.dir must not be the project root or inside a durable scaffold directory (parts, notes, profiles)"
  }
);
