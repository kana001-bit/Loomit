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

export const notchSchema = z
  .object({
    // 設計判断: seam_ref は合印が載る縫い線への参照。notch は「この縫い線のここ」という合わせ目印であって、
    // 幾何の座標そのものではない。
    seam_ref: z.string().min(1),
    // position は縫い線上の正規化位置(0=始点, 1=終点)。connector range の from/to と同じ約束にそろえる。
    position: z.number().finite().min(0).max(1),
    // type は合印の種類(single/double/slit 等)。任意。
    type: z.string().min(1).optional(),
    // 設計判断: depth_mm は合印を縫い代方向にどれだけ深く入れるか(クリップ量)を表す編集フィーチャの param で、
    // 幾何の点そのものではない。Seamly2D の notchLength に対応する。厚地では深いと縫い代が弱り、浅いと厚みで
    // 見えない、という縫製判断が乗る層。仕上がり寸法系と同じ mm 規約。0/負は寸法指定なしとして扱うため positive。
    depth_mm: z.number().finite().positive().optional(),
    // 設計判断: width_mm は合印マークの幅。Seamly2D の notchWidth に対応する。depth と同じく「縫いやすさ」の
    // param であって、辺が合うかどうか(接続整合)は変えない。
    width_mm: z.number().finite().positive().optional()
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
    // 設計判断: length_mm は仕上がり線上の長さ=幾何の測定値であって、人が手で発明する authored 値ではない。
    // .val(正本)を評価して初めて出る計算値(seam path の弧長)で、Loomit は幾何を計算しない(A案)。
    // よって scaffold(loom add)時は未測定(optional)を許し、値は Valentina / seamlint / truer が測って埋める。
    // 未測定の connector は identity(type)だけを持ち、check の connector-length 比較からは外れる。
    length_mm: z.number().finite().nonnegative().optional(),
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
    // 設計判断: notches は「縫い合わせの合印」= 接続整合の編集フィーチャ。darts(体積・シルエット)とは別軸で、
    // record key が stable identity、各値は縫い線参照＋位置＋種別だけを持つ(幾何の点ではない)。
    notches: z.record(z.string().min(1), notchSchema).optional(),
    connectors: z.record(z.string().min(1), connectorSchema).optional(),
    // 設計判断: requires は寸法・タグ・素材などの直接条件を表し、version range ではない。
    requires: z.record(z.string().min(1), requirementSchema).optional(),
    tags: z.array(z.string().min(1)).optional()
  })
  .strict();

export type Connector = z.infer<typeof connectorSchema>;
export type Dart = z.infer<typeof dartSchema>;
export type Notch = z.infer<typeof notchSchema>;
export type Part = z.infer<typeof partSchema>;
export type PartStatus = z.infer<typeof partStatusSchema>;
export type Requirement = z.infer<typeof requirementSchema>;
