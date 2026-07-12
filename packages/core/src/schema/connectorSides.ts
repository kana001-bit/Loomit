// 縫い目(join)の side 宣言のトポロジ分類。connector-pairing(check の役割②)と Seamlint request 生成の両方が
// 同じ判定を使うための単一の真実。両者で別々に分岐すると drift して、片方(slnt 単独実行)だけ不正トポロジを
// 見逃す、といった食い違いが起きる。参加が2枚以上の join に対して呼ぶ(1枚=open は呼ぶ前に別途扱う)。
export type JoinSideTopology =
  // side を1つも宣言していない = coincident(重ね)。N 枚が1本に参加してよい(見返し/裏地/ポケット重ね)。
  | { readonly kind: "coincident" }
  // 全参加が side を宣言し、種類がちょうど2 = contiguous(連続2側・和で合う。armhole 等)。
  | { readonly kind: "contiguous"; readonly sides: readonly string[] }
  // 一部だけ side / side が1種だけ = 側の宣言が不完全。
  | { readonly kind: "sides-incomplete"; readonly reason: "mixed" | "one-side" }
  // side が3種以上 = 1本の縫い目に3 unit で組めない。
  | { readonly kind: "too-many-sides"; readonly sides: readonly string[] };

export function classifyJoinSides(
  sides: readonly (string | undefined)[]
): JoinSideTopology {
  const declared = sides.filter((side): side is string => side !== undefined);

  if (declared.length === 0) {
    return { kind: "coincident" };
  }
  if (declared.length !== sides.length) {
    return { kind: "sides-incomplete", reason: "mixed" };
  }

  const distinct = [...new Set(declared)].sort((left, right) => left.localeCompare(right));

  if (distinct.length === 2) {
    return { kind: "contiguous", sides: distinct };
  }
  if (distinct.length === 1) {
    return { kind: "sides-incomplete", reason: "one-side" };
  }
  return { kind: "too-many-sides", sides: distinct };
}
