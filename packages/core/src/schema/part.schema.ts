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
    allowance_mm: z.number().finite().nonnegative().optional(),
    // 設計判断: ease_ratio_min / ease_ratio_max は ease seam の「意図した長さ差」を許容する帯(下限/上限)。
    // ease seam は両辺の長さが ease 分だけわざと異なるので、その差を「間違い」ではなく「意図した ease」として
    // 通すために Seamlint へ渡す帯。Loomit は幾何を計算しない(A案)ので比は測れず、人/上流が authored する値
    // (Seamlint の easeRatio と同義で diff/baseLength の許容範囲、0 <= min <= max)。片側だけでは帯にならない
    // ため、下の refine で両方揃えて宣言することを要求する。単位は無次元(比)なので mm 系の allowance_mm とは別立て。
    ease_ratio_min: z.number().finite().nonnegative().optional(),
    ease_ratio_max: z.number().finite().nonnegative().optional()
  })
  .strict()
  .refine((range) => range.from <= range.to, {
    message: "connector range start must be less than or equal to end"
  })
  // ease 帯は下限と上限が対でひとつの帯になる。片方だけでは Seamlint に渡す [min, max] を作れないので、
  // 両方あるか両方無いかのどちらかに限る。
  .refine(
    (range) => (range.ease_ratio_min === undefined) === (range.ease_ratio_max === undefined),
    {
      message: "connector range ease_ratio_min and ease_ratio_max must be set together"
    }
  )
  // 帯は下限 <= 上限。逆転した帯は Seamlint 側で無効化されるので、正本 schema で先に弾く。
  .refine(
    (range) =>
      range.ease_ratio_min === undefined ||
      range.ease_ratio_max === undefined ||
      range.ease_ratio_min <= range.ease_ratio_max,
    {
      message: "connector range ease_ratio_min must be less than or equal to ease_ratio_max"
    }
  );

export const connectorSchema = z
  .object({
    type: z.string().min(1),
    // 設計判断: length_mm は仕上がり線上の長さ=幾何の測定値であって、人が手で発明する authored 値ではない。
    // .val(正本)を評価して初めて出る計算値(seam path の弧長)で、Loomit は幾何を計算しない(A案)。
    // よって scaffold(loom add)時は未測定(optional)を許し、実測は Seamlint(loom slnt check)が担う(宣言値なら手で埋める)。
    // 未測定の connector は identity(type)だけを持ち、check の connector-length 比較からは外れる。
    length_mm: z.number().finite().nonnegative().optional(),
    tolerance_mm: z.number().finite().nonnegative().optional(),
    path_ref: z.string().min(1).optional(),
    // 設計判断: seam-edge の per-connector 識別子=この seam の合印(notch)数。path_ref が BLOCK 全体を指すとき、
    // Seamlint は同じ2 BLOCK を共有する複数 seam(front↔back の outseam/inseam 等)を「辺ごとの notch 署名」で
    // 区別する。notch の位置測定は Seamlint(幾何)だが、「どの seam に合印が何個あるか」は型紙の知識=人が宣言する
    // identity なので Loomit 側に持つ(A案を守る)。数のみ(将来 order/type/位置へ拡張余地)。
    // 数え方: その辺に落ちる全 passmark 種別(V/スリット・T・castle・check・U…)の合計を数える。V だけ数えない。
    // Seamlint は DXF notch を全レイヤ(layer 4/80/81/82/83)から読み、辺の実測数と notch_count を厳密一致で
    // 照合するので、V のみだと T を持つ seam で数が食い違い no-notch-match を誤発火させる(.val reader も種別を
    // 区別せず全 passmark を拾うため、この規約は Loomit の抽出結果とも一致する)。
    // 0 も有効値: 「合印の無い seam」と明示すれば、notch を持つ候補を弾いて識別子になる(nonnegative)。
    notch_count: z.number().int().nonnegative().optional(),
    // 設計判断: side は「この縫い目で、このピースがどちらの unit(側)に属すか」のラベル。armhole のように
    // 多パーツの端どうしを1本で縫う contiguous な縫い目で、参加ピースを2つの側(身頃側/袖側)にまとめる。
    // side を宣言した縫い目は「参加ピース数が2を超えても over-pair でない(側がちょうど2なら健全)」と判定する。
    // side 無しは従来どおり coincident(重ね・各参加が等長)として扱う。unit 所属は縫い目ごと(front は脇では
    // piece 単位、armhole では身頃 unit)なので part ではなく connector に載せる。幾何(和の実測)は Seamlint。
    side: z.string().min(1).optional(),
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
    // type は role を省いて `loom add` したとき role の既定値になり(role は project の
    // parts/<role>/ ディレクトリ segment)、".." を含みうる任意文字列ではなく安全な単一 segment
    // でなければならない。
    type: pathSegmentSchema,
    status: partStatusSchema.optional(),
    // files.* は build が読み込み・コピーする。schema は絶対パスと ".." を拒否し、実パスへの解決は
    // resolvePartFilePath が担う(project root 相対を優先し、root に無ければ part ディレクトリ相対)。
    // 境界は project root であって part ディレクトリではない(buildProject の BUILD_INPUT_ESCAPES_PROJECT
    // が多層防御として同じ境界を見る)。
    files: z
      .object({
        source: relativePathSchema.optional(),
        piece: z.string().min(1).optional(),
        preview: relativePathSchema.optional(),
        // 設計判断: geometry は測定用の幾何 artifact(DXF-ASTM 等)への参照(解決規則は上の files.* と同じ)。
        // preview(視覚用 SVG)とは
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
