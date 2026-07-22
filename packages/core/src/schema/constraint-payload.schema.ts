import { z } from "zod";

// Truer に渡す拘束 payload の **契約 schema**（クロスリポ）。この zod を単一ソースに JSON Schema を生成し
// （`constraintPayloadJsonSchema`）、Truer は言語非依存でそれに対して validate する。TS 型の詳細な設計コメントは
// `../truer/assembleConstraintPayload.ts` の interface 側に置く（ここは contract の形だけ）。emitter 出力が本 schema を
// 通ること・生成 JSON Schema が committed artifact と一致することは test で固定する。

// payload の版付け識別子。file schema（loomit.part.v0 等）と同じ規約。consumer は未知版を弾ける。
// 形を破壊的に変えるときは v1 へ上げる（additive なフィールド追加は上げない）。
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
export const constraintConnectorRefSchema = z
  .object({
    partId: z.string(),
    connectorId: z.string()
  })
  .strict();

// part 単位の依存（その piece の全 seam の occurrence が混ざる）。
export const constraintPartSchema = z
  .object({
    partId: z.string(),
    piece: z.string(),
    dependsOn: z.array(valOccurrenceSchema)
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
