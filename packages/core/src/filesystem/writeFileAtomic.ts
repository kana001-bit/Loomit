import { randomUUID } from "node:crypto";
import { rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

// 単一ファイルの atomic write。同じディレクトリの一時ファイルに書いてから target へ rename する。
// 同一ボリューム内の rename は原子的なので、途中のエラー・クラッシュ・Ctrl-C で書きかけのファイルが
// 残ることはない。説明可能なエラーが必要な呼び出し側は、これを try で包み、投げられたエラーを
// describeFsError に渡すこと。
export async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`);

  try {
    await writeFile(tempPath, contents, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    // 一時ファイルの後始末はベストエフォート。投げられた書き込みエラーが本来の失敗。
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}
