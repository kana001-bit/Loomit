import type { Connector } from "./part.schema.js";

// range id をキーに、突き合わせに必要な値だけを持つ形へ引き直したもの。
export interface IndexedConnectorRange {
  readonly from: number;
  readonly to: number;
  readonly behavior: string;
  readonly allowance_mm?: number;
  // ease seam の許容帯(下限/上限)。schema の refine で min/max は必ず対で存在するが、突き合わせ側の
  // undefined ガードを楽にするため個別 optional のまま持つ。
  readonly ease_ratio_min?: number;
  readonly ease_ratio_max?: number;
}

// connector.ranges を range id をキーにした record に引き直す。id ごとに range を突き合わせる処理
// (partDiff の range 比較、Seamlint request の subrange 対応付け)で共有する。schema の refine で
// range id は connector 内で一意なので、後勝ちで先行 range を取りこぼすことはない。
export function indexConnectorRanges(
  connector: Connector
): Readonly<Record<string, IndexedConnectorRange>> {
  const ranges: Record<string, IndexedConnectorRange> = {};

  for (const range of connector.ranges ?? []) {
    ranges[range.id] = {
      from: range.from,
      to: range.to,
      behavior: range.behavior,
      ...(range.allowance_mm === undefined ? {} : { allowance_mm: range.allowance_mm }),
      ...(range.ease_ratio_min === undefined ? {} : { ease_ratio_min: range.ease_ratio_min }),
      ...(range.ease_ratio_max === undefined ? {} : { ease_ratio_max: range.ease_ratio_max })
    };
  }

  return ranges;
}
