import { access } from "node:fs/promises";

import { getErrno } from "./fsError.js";

// パス存在確認の結果。access() の失敗を一律 false に潰すと、権限エラー(EACCES/EPERM)を「ファイルが無い」と
// 誤診したり、読めないファイルを「無い」とみなして上書きしてしまう。R3(errno を捨てない / operational-constraints
// F4)に従い、「本当に無い(missing)」と「アクセスできない(inaccessible)」を分けて返す。後者は呼び出し側が
// errno 分類つきの Diagnostic を出せるよう、捕捉した error をそのまま保持する。
export type PathExistence =
  | { readonly kind: "exists" }
  | { readonly kind: "missing" }
  | { readonly kind: "inaccessible"; readonly error: unknown };

// access() が投げた error を missing / inaccessible に振り分ける純関数(FS を触らないので単体テストしやすい)。
// ENOENT(パス自体が無い)と ENOTDIR(途中の要素がディレクトリでない = そのパスにファイルは無い)だけを
// 「無い」とみなす。それ以外の errno(EACCES / EPERM / EIO ...)は存在の有無を判定できないので inaccessible とし、
// error を保持して呼び出し側の describeFsError に渡せるようにする。
export function classifyAccessError(
  error: unknown
): { readonly kind: "missing" } | { readonly kind: "inaccessible"; readonly error: unknown } {
  const errno = getErrno(error);

  if (errno === "ENOENT" || errno === "ENOTDIR") {
    return { kind: "missing" };
  }

  return { kind: "inaccessible", error };
}

// パスが存在するかを確認する。存在ガードは本質的に TOCTOU(operational-constraints F2)なので、判定と直後の
// I/O の間に状態が変わりうる前提で使うこと。access() の失敗は classifyAccessError で missing/inaccessible に分ける。
export async function checkPathExistence(path: string): Promise<PathExistence> {
  try {
    await access(path);
    return { kind: "exists" };
  } catch (error) {
    return classifyAccessError(error);
  }
}
