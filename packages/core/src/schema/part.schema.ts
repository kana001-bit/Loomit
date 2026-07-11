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
    // 設計判断: seam_ref は合印が載る縫い線への参照(Seamly2D 方言)。notch は「この縫い線のここ」という合わせ
    // 目印であって幾何の座標そのものではない。実 Valentina では合印は detail 内の node であり、名前付き縫い線に
    // 載らない(どの辺かは仕上がり線の幾何=下流の話)ため、seam_ref は持てない。よって optional にし、実
    // Valentina 由来の合印は piece 側で識別する。
    seam_ref: z.string().min(1).optional(),
    // 設計判断: piece は合印が属する detail(型紙ピース)名 = DXF export の BLOCK 名。実 Valentina の合印は
    // 縫い線ではなく detail に属し、これが「どの .val passmark = どの DXF notch か」を突き合わせる identity に
    // なる。Seamly2D 方言(seam path)では seam_ref が identity を担うため piece は無くてよい。よって optional。
    piece: z.string().min(1).optional(),
    // 設計判断: order は同一 piece 内での passmark の並び順(0始まり・contour/node 順)。実 Valentina 由来の合印は
    // position(幾何)を持たないため、DXF export(layer4=V/layer80=T の POINT を seam 順に並べたもの)と「piece＋
    // 種別＋この順序」で 1:1 対応させる突き合わせキーになる。同一 piece に同種の合印が複数あっても区別できる。
    // Seamly2D 方言(position 保持)では設定しない。任意。
    order: z.number().int().nonnegative().optional(),
    // position は縫い線上の正規化位置(0=始点, 1=終点)。connector range の from/to と同じ約束。Seamly2D 方言では
    // .val が position を持つが、実 Valentina には存在しない(位置は仕上がり線の弧長=幾何で、Seamlint が DXF から
    // 測って解決する)。Loomit は幾何を計算しない(A案)ので、実 Valentina 由来の合印は position を持たない。optional。
    position: z.number().finite().min(0).max(1).optional(),
    // type は合印の種類。Seamly2D の passmarkType(single/double/slit 等)、または実 Valentina の
    // passmarkLine(vMark/tMark 等 = V合印/T合印)。DXF handoff の突き合わせは種別(V/T)を使う。任意。
    type: z.string().min(1).optional(),
    // 設計判断: angle は実 Valentina の passmarkAngle(合印の向きの決め方: straightforward/bisector 等)。
    // 「合印をどちら向きに入れるか」の編集フィーチャで、depth/width と同じく辺が合うか(接続整合)は変えない。任意。
    angle: z.string().min(1).optional(),
    // 設計判断: depth_mm は合印を縫い代方向にどれだけ深く入れるか(クリップ量)を表す編集フィーチャの param で、
    // 幾何の点そのものではない。Seamly2D の notchLength に対応する。厚地では深いと縫い代が弱り、浅いと厚みで
    // 見えない、という縫製判断が乗る層。仕上がり寸法系と同じ mm 規約。0/負は寸法指定なしとして扱うため positive。
    depth_mm: z.number().finite().positive().optional(),
    // 設計判断: width_mm は合印マークの幅。Seamly2D の notchWidth に対応する。depth と同じく「縫いやすさ」の
    // param であって、辺が合うかどうか(接続整合)は変えない。
    width_mm: z.number().finite().positive().optional()
  })
  .strict()
  // 設計判断: 合印は「どこに属すか」の anchor が要る。Seamly2D 方言は seam_ref、実 Valentina 方言は piece が
  // それを担う。両方欠けた合印は所属不明で identity を持てないため、正本 schema で弾く。
  .refine((notch) => notch.seam_ref !== undefined || notch.piece !== undefined, {
    message: "notch must anchor to a seam (seam_ref) or a piece (piece)"
  });

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
        piece: z.string().min(1).optional(),
        preview: relativePathSchema.optional(),
        // 設計判断: geometry は測定用の幾何 artifact(DXF-ASTM 等)への part 相対パス。preview(視覚用 SVG)とは
        // 別立てにする。SVG は detail identity も notch も落とすが、DXF(ASTM)は BLOCK 名=detail と縫い線
        // (layer 14)を保持するため、Seamlint に「どの座標を測るか」を渡せる。意味(identity)は .val/.loom 側の
        // 責務のまま変えない(docs/seamlint-dxf-export-request.md)。
        geometry: relativePathSchema.optional(),
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
