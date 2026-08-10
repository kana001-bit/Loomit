import { describe, expect, it } from "vitest";

import { collectCollidingPieceNames, findCollidingRoleNames } from "../../src/index.js";

// role キーの正規化。実 FS の case 感度は isCaseInsensitiveFileSystemAt で測るものなので、
// 純粋な判定のテストでは両モードを直に注入して決定的に確かめる。
const caseInsensitiveKey = (role: string): string => role.toLowerCase();
const caseSensitiveKey = (role: string): string => role;

describe("findCollidingRoleNames", () => {
  it("flags exact duplicates in either filesystem mode", () => {
    // 守る仕様: 完全一致はどちらの FS でも role 衝突する。初出の綴りを1回だけ返す。
    expect(findCollidingRoleNames(["front", "back", "front"], false)).toEqual(["front"]);
    expect(findCollidingRoleNames(["front", "back", "front"], true)).toEqual(["front"]);
  });

  it("flags case-only differences only on case-insensitive filesystems", () => {
    // 守る仕様: 大文字小文字を区別しない FS(Windows/macOS): Front と front は同じ parts/ に解決 = 衝突。両綴りを返す。
    expect(findCollidingRoleNames(["Front", "front"], true)).toEqual(["Front", "front"]);
    // 区別する FS(Linux 等): 別ディレクトリなので衝突しない。
    expect(findCollidingRoleNames(["Front", "front"], false)).toEqual([]);
  });

  it("returns nothing when every name is distinct", () => {
    // 守る仕様: すべて別名なら衝突は無く空配列を返す。
    expect(findCollidingRoleNames(["front", "back", "sleeve"], true)).toEqual([]);
  });

  it("reports every spelling of a collision once, in first-seen order", () => {
    // 守る仕様: 衝突は「どの綴りがぶつかったか」を全て返す(ケース違いを報告から読み取れるように)。
    // 同じ綴りが3回出ても報告は1回で、順序は初出順。報告文にそのまま並べられる形を固定する。
    expect(findCollidingRoleNames(["Front", "front", "FRONT", "back"], true)).toEqual([
      "Front",
      "front",
      "FRONT"
    ]);
  });
});

describe("collectCollidingPieceNames", () => {
  it("flags a piece that collides with an already-registered role", () => {
    // 守る仕様: 既存 part の role(seed)とぶつかるピースは、書き込み前に衝突として拾う。
    // これを見逃すと同じ parts/<role>/ に二重登録して先の part を踏む。
    expect(
      collectCollidingPieceNames(["front", "back"], new Set(["front"]), caseInsensitiveKey)
    ).toEqual(["front"]);
  });

  it("flags the later piece when two pieces in the same batch collide", () => {
    // 守る仕様: seed に無くても、先行ピースが取った role とぶつかれば衝突。返すのは**後から来た方**だけ
    // (先に居た方はそのまま使えるので、別 role を訊く対象は後続のみ)。
    expect(collectCollidingPieceNames(["front", "front"], new Set(), caseInsensitiveKey)).toEqual([
      "front"
    ]);
  });

  it("follows the injected normalizer for case sensitivity", () => {
    // 守る仕様: 衝突するかどうかは注入された正規化に従う。case を畳む FS では Front と front は同じ
    // parts/ に解決して衝突し、区別する FS では別ディレクトリなので衝突しない。
    expect(collectCollidingPieceNames(["Front", "front"], new Set(), caseInsensitiveKey)).toEqual([
      "front"
    ]);
    expect(collectCollidingPieceNames(["Front", "front"], new Set(), caseSensitiveKey)).toEqual([]);
  });

  it("does not mutate the seed set it was given", () => {
    // 守る仕様: 判定はコピーで回し、呼び出し側の seed(既存 role の集合)を書き換えない。
    // 破壊すると、呼び出し側がこの後に使う「元から居た role」のスナップショットが崩れ、
    // 衝突理由の言い分け(既に add 済み / .val 内の重複)が誤る。
    const seeded = new Set(["front"]);

    collectCollidingPieceNames(["back", "sleeve"], seeded, caseInsensitiveKey);

    expect([...seeded]).toEqual(["front"]);
  });

  it("returns nothing when no piece collides", () => {
    // 守る仕様: 衝突が無ければ空配列。呼び出し側は誰にも role を訊かずに済む(--yes が質問ゼロで通る条件)。
    expect(
      collectCollidingPieceNames(["front", "back"], new Set(["sleeve"]), caseInsensitiveKey)
    ).toEqual([]);
  });
});
