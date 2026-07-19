import { access } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

// 実ファイルシステムが大文字小文字を区別するかを、既存ファイル(プローブ)を綴り違いの名前で引けるか
// 試して判定する。プラットフォーム固定(macOS を一律 case-insensitive とする等)は case-sensitive な
// APFS/HFS+ を誤判定するため、実 FS を直接見る。判定材料が無い(英字を含まない)ときは insensitive 側
// に倒す(登録済み・衝突を広めに拾う=安全側)。プローブには loomit.yml など存在が確認済みのファイルを
// 渡すこと(存在しないプローブは常に「区別する」に見えてしまう)。
export async function isCaseInsensitiveFileSystemAt(probeFilePath: string): Promise<boolean> {
  const base = basename(probeFilePath);
  const flipped = flipAlphaCase(base);

  // 反転できる英字が無ければ判定材料が無い。安全側(insensitive)に倒す。
  if (flipped === base) {
    return true;
  }

  try {
    await access(join(dirname(probeFilePath), flipped));
    return true; // 綴り違いで引けた = 区別しない FS
  } catch {
    return false; // 引けない = 区別する FS(プローブ自体の存在は呼び手が保証する)
  }
}

// 英字だけ大文字↔小文字を反転する(FS の case 感度プローブ用)。
function flipAlphaCase(value: string): string {
  let flipped = "";

  for (const ch of value) {
    const lower = ch.toLowerCase();
    flipped += ch === lower ? ch.toUpperCase() : lower;
  }

  return flipped;
}
