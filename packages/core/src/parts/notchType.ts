// Valentina .val の passmarkLine 属性値 → ASTM notch 種別(Seamlint と同じ意味論 enum)への写像。
// 幾何評価なし・.val の文字列だけで決まる純関数。写像できない値は undefined を返し、呼び出し側は notchType を省く。
//
// 出所(cross-repo 事実・upstream ソース確認済み):
//   ① .val 文字列 → PassmarkLineType: Valentina upstream `src/libs/vmisc/def.cpp` StringToPassmarkLineType。
//   ② PassmarkLineType → ASTM layer: 同 `src/libs/vdxf/vdxfengine.cpp` ExportASTMNotch。
//   ③ layer の意味: Seamlint `docs/work/seamlint-notch-layer-mapping.md`(upstream 確認済み)。
//
// layer4 は {OneLine, TwoLines, ThreeLines, ExternalVMark, InternalVMark} を1枚に束ねる = Seamlint は DXF 上でこの一族を
// 形状区別せず layer4 の POINT として読む。よって Loomit も一族すべてを "v" に寄せる(DXF 粒度 = Seamlint が比較できる
// 粒度に正規化する。個々の生値は payload の rawPassmarkLine に verbatim で残す)。種別は弱い tie-breaker(Loomit の .val
// 種別と Seamlint の DXF 種別が食い違えば順序へ degrade)なので、写像は「Seamlint が区別できる粒度」で足りる。
export type NotchType = "v" | "t" | "castle" | "check" | "u";

// キーは .val の passmarkLine 属性値そのまま(def.cpp のシリアライズ文字列)。
const PASSMARK_LINE_TO_NOTCH_TYPE: Readonly<Record<string, NotchType>> = {
  // layer4 一族(Seamlint は "v" として読む)。
  one: "v",
  two: "v",
  three: "v",
  vMark: "v",
  vMark2: "v",
  // layer80/81/82/83。
  tMark: "t",
  boxMark: "castle",
  checkMark: "check",
  uMark: "u"
};

// passmarkLine 属性値を Seamlint の notch 種別 enum に正規化する。未知値は undefined を返す
// (写像できないものは notchType を省き、種別 tie-break に使わず順序で拾う = 安全側)。
export function notchTypeFromPassmarkLine(passmarkLine: string): NotchType | undefined {
  return PASSMARK_LINE_TO_NOTCH_TYPE[passmarkLine];
}
