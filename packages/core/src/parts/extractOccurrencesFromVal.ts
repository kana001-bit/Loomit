import { collectBlocks, collectFirstBlock, collectSelfClosingTags } from "./valXml.js";

// 拘束 payload の occurrence(出現)1件。辺の仕上がり長にどう効くかは param そのものでなく「どこに出現したか」で
// 決まる(同じ増分が別 point 型で出る)ため、linearity は occurrence 側に載せる(payload 契約 dependsOn[])。
// expr は宣言式をそのまま持つ(評価しない=A案)。refs は式が参照する増分名(先頭#付き。Slice 1 の increment と突き合う)。
export type OccurrenceLinearity = "linear" | "nonlinear" | "none";

// spline の制御ハンドル。曲線形状=非線形の長さ寄与。
export type SplineHandle = "length1" | "length2" | "angle1" | "angle2";

export type ValOccurrence =
  | {
      readonly pointId: string;
      readonly type: string;
      readonly linearity: OccurrenceLinearity;
      readonly expr: string;
      readonly refs: readonly string[];
    }
  | {
      readonly splineId: string;
      readonly handle: SplineHandle;
      readonly linearity: OccurrenceLinearity;
      readonly expr: string;
      readonly refs: readonly string[];
    };

export interface ValDrawOccurrences {
  readonly drawName: string;
  readonly occurrences: readonly ValOccurrence[];
}

const SPLINE_HANDLES: readonly SplineHandle[] = ["length1", "length2", "angle1", "angle2"];

// draw ごとの <calculation> から occurrence を抽出する。read-only・値は評価しない純関数。
export function extractOccurrencesFromValText(source: string): readonly ValDrawOccurrences[] {
  return collectBlocks(source, "draw").map((drawBlock) => {
    const drawName = drawBlock.attrs.name ?? "draw";
    const calculation = collectFirstBlock(drawBlock.content, "calculation");

    return {
      drawName,
      occurrences:
        calculation === undefined ? [] : extractOccurrencesFromCalculationContent(calculation.content)
    };
  });
}

// 1つの <calculation> の中身から occurrence を抽出する。特定の draw を名前でなく中身で指せるよう分離してある
// (同名 draw があっても取り違えない)。
// point は length を持つものだけ(導出点=pointOfIntersection 等は長さパラメータを持たないので対象外)。
// spline は制御ハンドル(length1/2・angle1/2)を1本ずつ occurrence にする。
// スコープ外(現状 defer): 点の angle 属性 / <arc>(radius・angles) / <operation type="moving">。outseam が通らないため後段送り。
export function extractOccurrencesFromCalculationContent(
  calculationContent: string
): readonly ValOccurrence[] {
  const occurrences: ValOccurrence[] = [];

  for (const point of collectSelfClosingTags(calculationContent, "point")) {
    const pointId = point.attrs.id;
    const rawLength = point.attrs.length;

    // length を持たない点(導出点・基点)は長さの操作対象にならないので occurrence にしない。
    if (pointId === undefined || rawLength === undefined) {
      continue;
    }

    const expr = rawLength.trim();

    if (expr.length === 0) {
      continue;
    }

    const type = point.attrs.type ?? "";
    occurrences.push({
      pointId,
      type,
      linearity: classifyPointLinearity(type),
      expr,
      refs: extractIncrementRefs(expr)
    });
  }

  for (const spline of collectSelfClosingTags(calculationContent, "spline")) {
    const splineId = spline.attrs.id;

    if (splineId === undefined) {
      continue;
    }

    for (const handle of SPLINE_HANDLES) {
      const rawValue = spline.attrs[handle];

      if (rawValue === undefined) {
        continue;
      }

      const expr = rawValue.trim();

      if (expr.length === 0) {
        continue;
      }

      // 制御ハンドルは曲線形状=非線形の長さ寄与(数値提案には昇格させない)。
      occurrences.push({
        splineId,
        handle,
        linearity: "nonlinear",
        expr,
        refs: extractIncrementRefs(expr)
      });
    }
  }

  return occurrences;
}

// 辺長への効きを occurrence type=幾何的役割から決める(評価不要・構造だけ)。
// endLine/alongLine/normal は length 属性が直接の距離=線形。cutSpline はカーブ上の位置で長さを変えない=none。
// 未知/導出点は保守的に none(誤って linear にすると数値提案へ昇格してしまうため)。
function classifyPointLinearity(type: string): OccurrenceLinearity {
  switch (type) {
    case "endLine":
    case "alongLine":
    case "normal":
      return "linear";
    case "cutSpline":
      return "none";
    default:
      return "none";
  }
}

// 式が参照する増分名(#name)を宣言順・重複なしで拾う。measurement(# 無し)や擬似変数(CurrentLength)は
// 増分ではないので refs には入れない — expr 文字列には残るので下流はそのまま読める。
function extractIncrementRefs(expr: string): readonly string[] {
  const seen = new Set<string>();
  const refs: string[] = [];

  for (const match of expr.matchAll(/#[A-Za-z_][A-Za-z0-9_]*/g)) {
    const ref = match[0];

    if (!seen.has(ref)) {
      seen.add(ref);
      refs.push(ref);
    }
  }

  return refs;
}
