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

// 1本の縫い目の片側と、そこに何枚参加しているか。band 判定に要るのは枚数だけで、参加者が何者かは要らない
// (幾何の request を組む側は JoinParticipant を、authoring 側は role 名を持っているが、どちらも枚数に均せる)。
export interface JoinSideSize {
  readonly side: string;
  readonly size: number;
}

// band 形の判定結果。**band は side ラベルではなく「ちょうど1枚で残った側」で決まる。**
export type BandShape =
  // 片側がちょうど1枚・反対側が複数枚 = band 形。band はその1枚の側。
  | { readonly kind: "band"; readonly bandSide: string; readonly neighbourSide: string }
  // 側は2つあるがどちらも1枚。まだ band-seam にならず(参加2枚は pairwise 経路)、どちらが物理的な band かも
  // 側の枚数からは決まらない。3枚目がどちらに付くかで band が確定する。
  | { readonly kind: "undecided"; readonly sides: readonly [string, string] }
  // band 形にならない。both-sides-multiple = 和が band へ一意に解けない / not-contiguous = 側の構成が
  // そもそも contiguous でない(側が2つでない、または side を宣言していない参加者がいる)。
  | { readonly kind: "none"; readonly reason: "both-sides-multiple" | "not-contiguous" };

// 側ごとの枚数から band 形を決める。**この判定の唯一の正本**。
//
// createGeometryRequest(band-seam を emit するか)と authoring(既存の縫い目に足してよい側はどれか)は
// 同じ問いを別の場所で解いていた。片方だけ直しても drift するので、規則はここに1つだけ置く。
//
// participantCount は「その縫い目に参加している総数」。sides の合計と食い違うなら side を宣言していない
// 参加者がいる(classifyJoinSides の mixed)ということなので、band 形にはしない。
export function resolveBandShape(
  sides: readonly JoinSideSize[],
  participantCount: number
): BandShape {
  const declared = sides.reduce((total, side) => total + side.size, 0);

  if (sides.length !== 2 || declared !== participantCount) {
    return { kind: "none", reason: "not-contiguous" };
  }

  const [first, second] = sides;

  if (first === undefined || second === undefined) {
    return { kind: "none", reason: "not-contiguous" };
  }

  const singletons = sides.filter((side) => side.size === 1);

  if (singletons.length === 2) {
    return { kind: "undecided", sides: [first.side, second.side] };
  }

  const band = singletons[0];

  if (band === undefined) {
    return { kind: "none", reason: "both-sides-multiple" };
  }

  const neighbour = first === band ? second : first;

  return { kind: "band", bandSide: band.side, neighbourSide: neighbour.side };
}

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
