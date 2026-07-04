import { z } from "zod";

import { pathSegmentSchema, relativePathSchema } from "./paths.js";

export const partStatusSchema = z.enum(["active", "deprecated"]);

const finishedMeasurementSchema = z.number().finite().nonnegative();

const dartLegRefsSchema = z
  .object({
    left_ref: z.string().min(1),
    right_ref: z.string().min(1)
  })
  .strict();

export const dartSchema = z
  .object({
    apex_ref: z.string().min(1),
    width_mm: z.number().finite().positive().optional(),
    width_formula: z.string().min(1).optional(),
    intake_length_mm: z.number().finite().positive().optional(),
    intake_length_formula: z.string().min(1).optional(),
    legs: dartLegRefsSchema
  })
  .strict();

const connectorRangeSchema = z
  .object({
    id: z.string().min(1),
    from: z.number().finite().min(0).max(1),
    to: z.number().finite().min(0).max(1),
    behavior: z.string().min(1),
    allowance_mm: z.number().finite().nonnegative().optional()
  })
  .strict()
  .refine((range) => range.from <= range.to, {
    message: "connector range start must be less than or equal to end"
  });

export const connectorSchema = z
  .object({
    type: z.string().min(1),
    // 設計判断: length_mm は仕上がり線上の長さであり、縫い代を含む裁断寸法ではない。
    length_mm: z.number().finite().nonnegative(),
    tolerance_mm: z.number().finite().nonnegative().optional(),
    path_ref: z.string().min(1).optional(),
    // range id は connector 内で一意でなければならない。diff は id をキーに range を突き合わせるため、
    // 重複を許すと先行 range が上書きされ、変更が黙って取りこぼされる。正本 schema で禁止する。
    ranges: z
      .array(connectorRangeSchema)
      .refine((ranges) => new Set(ranges.map((range) => range.id)).size === ranges.length, {
        message: "connector range ids must be unique"
      })
      .optional()
  })
  .strict();

const scalarRequirementValueSchema = z.union([z.string().min(1), z.number().finite(), z.boolean()]);

export const requirementSchema = z
  .object({
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    equals: scalarRequirementValueSchema.optional(),
    includes: z.array(z.string().min(1)).optional()
  })
  .strict()
  .refine(
    (requirement) =>
      requirement.min !== undefined ||
      requirement.max !== undefined ||
      requirement.equals !== undefined ||
      requirement.includes !== undefined,
    {
      message: "requirement must define at least one direct constraint"
    }
  );

export const partSchema = z
  .object({
    schema: z.literal("loomit.part.v0"),
    name: z.string().min(1),
    // 設計判断: variant は識別記号であり、順序を持つソフトウェアの version ではない。
    variant: z.string().min(1),
    // type は library のディレクトリ segment(types/<type>s/...)として使うため、".." を含みうる
    // 任意文字列ではなく、安全な単一 segment でなければならない。
    type: pathSegmentSchema,
    status: partStatusSchema.optional(),
    // files.* は build が読み込み・コピーする。part.loom が part ディレクトリ外のファイルを build に
    // 指させないよう part 相対に限定する(絶対パスと ".." は拒否)。
    files: z
      .object({
        source: relativePathSchema.optional(),
        preview: relativePathSchema.optional(),
        print: relativePathSchema.optional()
      })
      .strict()
      .optional(),
    measurements: z
      .object({
        finished: z.record(z.string().min(1), finishedMeasurementSchema).optional()
      })
      .strict()
      .optional(),
    // 設計判断: darts は raw geometry ではなく、diff/branch で意味を持つ編集フィーチャの record。
    // record key が stable identity で、各値は apex/legs 参照と主要パラメータだけを持つ。
    darts: z.record(z.string().min(1), dartSchema).optional(),
    connectors: z.record(z.string().min(1), connectorSchema).optional(),
    // 設計判断: requires は寸法・タグ・素材などの直接条件を表し、version range ではない。
    requires: z.record(z.string().min(1), requirementSchema).optional(),
    tags: z.array(z.string().min(1)).optional()
  })
  .strict();

export type Connector = z.infer<typeof connectorSchema>;
export type Dart = z.infer<typeof dartSchema>;
export type Part = z.infer<typeof partSchema>;
export type PartStatus = z.infer<typeof partStatusSchema>;
export type Requirement = z.infer<typeof requirementSchema>;
