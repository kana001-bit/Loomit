import { isAbsolute, relative } from "node:path";

// `candidate` が `root` そのもの、または `root` 配下にあるとき true。ファイル内容(parts.*,
// outputs.dir)や CLI 引数(--name, role)由来のパスが `..` や絶対パスで許可 root の外へ出るのを
// 防ぐために使う。両引数は事前に絶対パス化しておくこと(先に resolve() する)。
export function isPathWithin(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

// `value` が安全な単一パスセグメント(空でなく、"." でも ".." でもなく、区切り文字を含まない)のとき
// true。CLI 引数や識別子をディレクトリ名にする前に境界で使い、パスが外へ出たり複数セグメントに
// なったりしないようにする。
export function isSafePathSegment(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && !/[\\/]/.test(value);
}
