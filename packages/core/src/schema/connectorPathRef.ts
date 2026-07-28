// connector の `path_ref` を「幾何ソース上の path 識別子」へ正規化する共有規則。
//
// path_ref の書き方は幾何ソースの形式で違う: DXF なら BLOCK 名(`BACK`)、SVG なら `svg:path#armhole` のような
// fragment 付きの参照。fragment を持つ形は `#` 以降だけが実際の識別子なので取り出す。
//
// **単一ソースにしている理由**: この値は同じ綴りのまま2つの経路へ出て行く必要がある。
//   1. Seamlint request の `parts[].paths[connectorId]` → Seamlint は要求された綴りを診断の `blockName` に
//      **そのまま echo** する(値の解釈はせず、BLOCK 照合だけ大小無視で行う)。
//   2. Truer の拘束 payload の `connectors[].pathRef` → Truer は診断の `blockName` と突き合わせて part を引く。
// 片方だけ正規化する(あるいは片方が part.loom の生値を出す)と綴りが割れ、Truer の join が silent に落ちる。
// これは実際に起きた事故で、[C10] として cross-repo で詰めた結論が「両経路がこの1本を通る」。
// 大小の変換はしない ── Seamlint が綴りを保つので、正規化を揃えるだけで両者は厳密一致する。
export function normalizeConnectorPathRef(pathRef: string): string {
  const fragmentIndex = pathRef.indexOf("#");

  if (fragmentIndex >= 0 && fragmentIndex < pathRef.length - 1) {
    return pathRef.slice(fragmentIndex + 1);
  }

  return pathRef.startsWith("#") ? pathRef.slice(1) : pathRef;
}
