import { z } from "zod";

// Truer に渡す拘束 payload の **契約 schema**（クロスリポ）。この zod を単一ソースに JSON Schema を生成し
// （`constraintPayloadJsonSchema`）、Truer は言語非依存でそれに対して validate する。TS 型の詳細な設計コメントは
// `../truer/assembleConstraintPayload.ts` の interface 側に置く（ここは contract の形だけ）。emitter 出力が本 schema を
// 通ること・生成 JSON Schema が committed artifact と一致することは test で固定する。

// payload の版付け識別子。file schema（loomit.part.v0 等）と同じ規約。consumer は未知版を弾ける。
// 形を破壊的に変えるときは v1 へ上げる（additive なフィールド追加は上げない）。
//
// **additive 追加のときに必ず守る手順（この契約は全オブジェクトが `.strict()` = `additionalProperties: false`）。**
// strict は「綴り違いの field を黙って無視して値が落ちる」事故を防ぐための選択で、その代償として互換性が
// 非対称になる:
//   - 後方（旧 payload → 新 validator）: optional で足す限り保たれる。既存 payload は valid のまま。
//   - 前方（新 payload → **更新していない** validator）: **保たれない。** 未知 field を strict が弾くので
//     payload 全体が reject される。
// よって additive な追加でも **consumer 先行**で入れる。順序は必ず「① consumer が新 field を受理できる版を
// 出す → ② Loomit が emit を始める」。逆順にすると provenance が全部落ちる（fail-closed なので危険ではないが
// 機能停止する）。この手順を踏むなら版は v0 のままでよい ── v1 へ上げると未知版として**即座に全 consumer が
// 弾く**ので、非互換の窓を狭めるどころか広げる。
// 前例: `parts[].notches[]`（2026-07-25）、`connectors[].pathRef`（2026-07-28, [C10]。Truer PR #44/#45 が
// 受理側を先に main へ入れてから emit を開始した）。
export const CONSTRAINT_PAYLOAD_SCHEMA_ID = "loomit.constraint-payload.v0";

// occurrence の linearity（構造だけで決まる: cutSpline/導出点=none 等）。
const occurrenceLinearitySchema = z.enum(["linear", "nonlinear", "none"]);

// point 由来の occurrence（辺上の点の長さ寄与）。
const pointOccurrenceSchema = z
  .object({
    pointId: z.string(),
    type: z.string(),
    linearity: occurrenceLinearitySchema,
    expr: z.string(),
    refs: z.array(z.string())
  })
  .strict();

// spline 制御ハンドル由来の occurrence（曲線形状=非線形の長さ寄与）。
const splineOccurrenceSchema = z
  .object({
    splineId: z.string(),
    handle: z.enum(["length1", "length2", "angle1", "angle2"]),
    linearity: occurrenceLinearitySchema,
    expr: z.string(),
    refs: z.array(z.string())
  })
  .strict();

export const valOccurrenceSchema = z.union([pointOccurrenceSchema, splineOccurrenceSchema]);

// notch 種別（Seamlint と同じ意味論 enum）。.val の passmarkLine から写像できたときだけ載る（`../parts/notchType.ts`）。
const notchTypeSchema = z.enum(["v", "t", "castle", "check", "u"]);

// notch 単位のグループ（applicable 用の view）。dependsOn がフラットに混ぜていた「どの notch がどの spline を錨付け、
// その長さ候補はどれか」を notch ごとに束ねる。order は piece 輪郭順（位置でなく順序で両方向マッチ）。
//   rawPassmarkLine … .val の生値（vMark/tMark/one…）。属性が無ければ省く（発明しない）。
//   notchType … 生値を Seamlint enum に正規化したもの。写像できなければ省く（弱い tie-breaker）。
//   splineId / lengthCandidates … 合印が spline に載るときだけ。直線上の合印など spline を持たなければ splineId を省き
//     lengthCandidates は空（applicable は昇格しない）。lengthCandidates は dependsOn と同じ occurrence を再掲する。
const edgeNotchSchema = z
  .object({
    order: z.number().int(),
    rawPassmarkLine: z.string().optional(),
    notchType: notchTypeSchema.optional(),
    anchorPointId: z.string(),
    splineId: z.string().optional(),
    lengthCandidates: z.array(valOccurrenceSchema)
  })
  .strict();

// 増分 param。declared/value の不変条件を discriminated union で schema に落とす（#3 の区別＝「未宣言 ref」と
// 「formula 無しの宣言済みツマミ」を consumer が schema validation で信じられるように）:
//   declared:true  → value 必須（"" = formula 無しの既定0ツマミ）。note? は任意。
//   declared:false → 式で参照されたが <increments> に宣言が無い。value/note は持たない（strict が余剰キーを弾く）。
export const constraintParamSchema = z.discriminatedUnion("declared", [
  z
    .object({
      declared: z.literal(true),
      value: z.string(),
      usedBy: z.array(z.string()),
      note: z.string().optional()
    })
    .strict(),
  z
    .object({
      declared: z.literal(false),
      usedBy: z.array(z.string())
    })
    .strict()
]);

// connector は join 鍵のみ（dependsOn は持たない = [C6]）。
// pathRef は幾何ソース上の住所（正規化済みの `path_ref`）で、Seamlint 診断の `blockName` と綴りまで一致する。
// v0 契約では **optional**: `path_ref` 自体が optional なので identity だけの connector が正当に存在し、
// pathRef を持たない payload（この field を足す前の v0）も valid のまま保つ。必須化するなら schema id を v1 へ。
// 追加手順（consumer 先行）と、strict ゆえに前方互換が無いことは冒頭 CONSTRAINT_PAYLOAD_SCHEMA_ID のコメント参照。
// 詳細な設計判断（住所の権威が piece でなく connector にある理由）は `../truer/assembleConstraintPayload.ts` 側。
export const constraintConnectorRefSchema = z
  .object({
    partId: z.string(),
    connectorId: z.string(),
    pathRef: z.string().optional()
  })
  .strict();

// part 単位の依存（その piece の全 seam の occurrence が混ざる）。notches は同じ occurrence を notch 単位に束ね直した
// additive な view（dependsOn はフラットのまま残す = provenance-only 消費者を壊さない）。
// notches は v0 契約では **optional**: この emitter は常に emit する（空なら `[]`）が、notches を持たない既存 v0 payload も
// 契約上 valid のままにして版を上げずに後方互換を保つ。**必須化したいなら schema id を v1 へ上げること**（v0 のまま
// required にすると、旧 v0 payload をこの validator に通したときに notches 欠如だけで落ちる）。
export const constraintPartSchema = z
  .object({
    partId: z.string(),
    piece: z.string(),
    dependsOn: z.array(valOccurrenceSchema),
    notches: z.array(edgeNotchSchema).optional()
  })
  .strict();

export const constraintPayloadSchema = z
  .object({
    schema: z.literal(CONSTRAINT_PAYLOAD_SCHEMA_ID),
    params: z.record(z.string(), constraintParamSchema),
    parts: z.array(constraintPartSchema),
    connectors: z.array(constraintConnectorRefSchema)
  })
  .strict();

// zod を単一ソースに JSON Schema を生成する。Truer が copy して validate する共有 artifact
// （`packages/core/schema/constraint-payload.v0.json`）の生成元。test が生成物と committed を突き合わせて drift を防ぐ。
export function constraintPayloadJsonSchema() {
  return z.toJSONSchema(constraintPayloadSchema);
}
