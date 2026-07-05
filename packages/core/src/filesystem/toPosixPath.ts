import { sep } from "node:path";

// 正本ファイル(manifest.json / meta.yml など)に保存する相対パスを、実行 OS に依存しない
// POSIX 区切り("/")へ正規化する。Windows の path.relative / path.join は "\" 区切りを返すため、
// そのまま保存すると Windows で書いた project files を macOS / Linux で解釈できなくなる。
// 入力は path モジュールがこのプラットフォームで生成した相対パスを想定し、native な `sep` だけを
// "/" に置き換える(POSIX 上では backslash は正当なファイル名文字なので変換しない)。
export function toPosixPath(relativePath: string): string {
  return relativePath.split(sep).join("/");
}
