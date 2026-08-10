import { describe, expect, it } from "vitest";

import { resolveBandShape } from "../../src/index.js";

describe("resolveBandShape", () => {
  it("makes the side that holds exactly one piece the band", () => {
    // 守る仕様: band は side ラベルではなく「ちょうど1枚で残った側」で決まる。1枚の側が band、
    // 複数枚の側が neighbours(腰帯 ↔ 前+後)。この向きが逆になると band-seam の from が入れ替わる。
    expect(
      resolveBandShape(
        [
          { side: "band", size: 1 },
          { side: "neighbour", size: 2 }
        ],
        3
      )
    ).toEqual({ kind: "band", bandSide: "band", neighbourSide: "neighbour" });
  });

  it("does not care which side is listed first", () => {
    // 守る仕様: 判定は枚数だけで決まり、側の並び順や名前には依らない(`--band-side` で任意のラベルを
    // 付けられるので、ラベル名を手がかりにしてはいけない)。
    expect(
      resolveBandShape(
        [
          { side: "bodice", size: 3 },
          { side: "sleeve", size: 1 }
        ],
        4
      )
    ).toEqual({ kind: "band", bandSide: "sleeve", neighbourSide: "bodice" });
  });

  it("leaves the band undecided while both sides hold one piece", () => {
    // 守る仕様: 側が1枚ずつのときは band を決めない。この状態はまだ band-seam にならず(参加2枚は
    // pairwise 経路)、どちらが物理的な band かは枚数からは分からない ── 3枚目がどちらに付くかで確定する。
    // ここで片方を band と決めつけると、authoring が誤った側を安全と案内してしまう。
    expect(
      resolveBandShape(
        [
          { side: "band", size: 1 },
          { side: "neighbour", size: 1 }
        ],
        2
      )
    ).toEqual({ kind: "undecided", sides: ["band", "neighbour"] });
  });

  it("reports no band when both sides hold several pieces", () => {
    // 守る仕様: 両側とも複数枚は和が band へ一意に解けない。band 形にせず、幾何は Seamlint へ defer する
    // (SEAMLINT_CONNECTOR_SEAM_DEFERRED)。不正ではなく「測れない」なので reason で言い分ける。
    expect(
      resolveBandShape(
        [
          { side: "bodice", size: 2 },
          { side: "sleeve", size: 2 }
        ],
        4
      )
    ).toEqual({ kind: "none", reason: "both-sides-multiple" });
  });

  it("reports no band when a participant declares no side", () => {
    // 守る仕様: 側の合計が参加総数に足りない = side を宣言していない参加者がいる(classifyJoinSides の
    // mixed)。band 形にしない。ここを見落とすと、side 無しで相乗りした part を数え落としたまま
    // 「1枚の側」を band と決めてしまう。
    expect(
      resolveBandShape(
        [
          { side: "band", size: 1 },
          { side: "neighbour", size: 2 }
        ],
        4
      )
    ).toEqual({ kind: "none", reason: "not-contiguous" });
  });

  it("reports no band when the sides are not exactly two", () => {
    // 守る仕様: contiguous は側がちょうど2。1つだけ(one-side)も3つ以上(too-many-sides = error)も
    // band 形にはならない。
    expect(resolveBandShape([{ side: "hip", size: 2 }], 2)).toEqual({
      kind: "none",
      reason: "not-contiguous"
    });
    expect(
      resolveBandShape(
        [
          { side: "a", size: 1 },
          { side: "b", size: 1 },
          { side: "c", size: 1 }
        ],
        3
      )
    ).toEqual({ kind: "none", reason: "not-contiguous" });
  });

  it("reports no band for a seam with no sides at all", () => {
    // 守る仕様: side を1つも宣言していない縫い目(coincident=重ね)は band ではない。
    // 参加が何枚でも「重ねて1本で縫う」であって、和で合う contiguous ではない。
    expect(resolveBandShape([], 3)).toEqual({ kind: "none", reason: "not-contiguous" });
  });
});
