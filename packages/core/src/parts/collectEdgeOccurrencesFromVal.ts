import { createDiagnostic } from "../diagnostics/diagnostic.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { extractOccurrencesFromCalculationContent } from "./extractOccurrencesFromVal.js";
import type { ValOccurrence } from "./extractOccurrencesFromVal.js";
import { collectBlocks, collectFirstBlock, collectSelfClosingTags } from "./valXml.js";

export interface EdgeOccurrenceResult {
  readonly occurrences: readonly ValOccurrence[];
  readonly diagnostics: readonly Diagnostic[];
}

// 1つの piece(detail=DXF BLOCK)の合印が載るカーブ経由で、その seam 辺の長さに効きうる occurrence を集める。
//
// 経路(= [C1] 手追いと同じ): detail の passmark node.idObject → <modeling> の同 id の点 → その idObject = calculation 点
//   → calculation 点が cutSpline なら spline 属性で通過カーブを特定 → そのカーブ(spline)の端点(point1/point4)と
//     制御ハンドル(length1/2・angle1/2)の occurrence を集める。
//
// 重要な限界(= [C6], provenance-only では踏まない): connector は BLOCK 全体を指し、実際に測る辺は Seamlint が
//   発見する。よってここで返すのは「この piece の合印が載るカーブ上の occurrence」であって「測定辺そのもの」ではない。
//   数値提案(applicable)を出す段では Seamlint の測定辺端点と突き合わせて確定が要る。
export function collectEdgeOccurrencesFromValText(
  source: string,
  options: { readonly piece: string }
): EdgeOccurrenceResult {
  const pieceKey = options.piece.trim().toLowerCase();
  const lookup = findDrawWithDetail(source, pieceKey);

  if (lookup.status === "not-found") {
    return {
      occurrences: [],
      diagnostics: [
        createDiagnostic({
          severity: "warning",
          code: "PART_SOURCE_VAL_PIECE_NOT_FOUND",
          message:
            "指定した piece(detail)が .val に見つからないため、辺の occurrence を集められませんでした。 / Could not find the given piece (detail) in the .val, so no edge occurrences were collected.",
          target: options.piece,
          suggestion: [
            "files.piece が .val の detail 名(= DXF BLOCK 名)と一致しているか確認してください。 / Check that files.piece matches a detail name (the DXF block name) in the .val."
          ]
        })
      ]
    };
  }

  // piece は在るが draw に <calculation> が無い = .val が不完全。piece 名は正しいので「見つからない」とは別の案内にする。
  if (lookup.status === "no-calculation") {
    return {
      occurrences: [],
      diagnostics: [
        createDiagnostic({
          severity: "warning",
          code: "PART_SOURCE_VAL_CALCULATION_MISSING",
          message:
            "piece(detail)は見つかりましたが、その draw に <calculation> が無いため辺の occurrence を集められませんでした。 / Found the piece (detail) but its draw has no <calculation>, so no edge occurrences were collected.",
          target: options.piece,
          suggestion: [
            "完全な Valentina .val(製図の <calculation> を含む)を書き出しているか確認してください。 / Check that a complete Valentina .val (including the drafting <calculation>) was exported."
          ]
        })
      ]
    };
  }

  const draw = lookup.draw;

  // occurrence の正本は extractOccurrencesFromCalculationContent(linearity/refs の単一責務)。
  // 名前でなく found draw の calculation 中身から直接抽出する(同名 draw があっても取り違えない)。
  const pointOccurrenceById = new Map<string, ValOccurrence>();
  const splineOccurrencesById = new Map<string, ValOccurrence[]>();

  for (const occurrence of extractOccurrencesFromCalculationContent(draw.calculationContent)) {
    if ("pointId" in occurrence) {
      pointOccurrenceById.set(occurrence.pointId, occurrence);
    } else {
      const list = splineOccurrencesById.get(occurrence.splineId) ?? [];
      list.push(occurrence);
      splineOccurrencesById.set(occurrence.splineId, list);
    }
  }

  const modelingToCalc = buildModelingToCalc(draw.calculationOwnerContent);
  const calcPointById = indexCalcPoints(draw.calculationContent);
  const splineById = indexSplines(draw.calculationContent);

  const selected: ValOccurrence[] = [];
  const seen = new Set<string>();
  const add = (occurrence: ValOccurrence | undefined): void => {
    if (occurrence === undefined) {
      return;
    }

    const key =
      "pointId" in occurrence
        ? `p:${occurrence.pointId}`
        : `s:${occurrence.splineId}:${occurrence.handle}`;

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    selected.push(occurrence);
  };

  const splineIds: string[] = [];

  for (const anchorCalcId of collectDetailPassmarkAnchorCalcIds(draw.detailContent, modelingToCalc)) {
    // 合印そのものが載る点の occurrence(cutSpline=linearity none 等)。辺上の点なので含める。
    add(pointOccurrenceById.get(anchorCalcId));

    // cutSpline なら通過カーブを控える(端点・ハンドルは後でまとめて追加)。
    const splineId = calcPointById.get(anchorCalcId)?.spline;

    if (splineId !== undefined && !splineIds.includes(splineId)) {
      splineIds.push(splineId);
    }
  }

  for (const splineId of splineIds) {
    const spline = splineById.get(splineId);

    // カーブ端点(point1/point4)の長さ occurrence。導出点で length を持たない端点は occurrence が無く自然に落ちる。
    add(pointOccurrenceById.get(spline?.point1 ?? ""));
    add(pointOccurrenceById.get(spline?.point4 ?? ""));

    // カーブ形状の制御ハンドル(nonlinear)。
    for (const handleOccurrence of splineOccurrencesById.get(splineId) ?? []) {
      add(handleOccurrence);
    }
  }

  return { occurrences: selected, diagnostics: [] };
}

interface DrawWithDetail {
  // detail/modeling/calculation を含む <draw> の中身。modeling マップ構築に使う。
  readonly calculationOwnerContent: string;
  readonly calculationContent: string;
  readonly detailContent: string;
}

// piece 探索の結果。「見つからない」と「見つかったが calculation が無い(=不完全な .val)」を分けて、
// 呼び出し側が別の diagnostic を出せるようにする(前者は piece 名を疑え、後者は piece 名は正しい)。
type DrawLookup =
  | { readonly status: "found"; readonly draw: DrawWithDetail }
  | { readonly status: "no-calculation" }
  | { readonly status: "not-found" };

// piece(detail 名)を case-insensitive で持つ最初の draw を探す。detail 名照合は Seamlint の BLOCK 照合
// (大小無視)と揃える(projectNotchesFromVal と同じ約束)。
function findDrawWithDetail(source: string, pieceKey: string): DrawLookup {
  for (const drawBlock of collectBlocks(source, "draw")) {
    const detailsBlock = collectFirstBlock(drawBlock.content, "details");

    if (detailsBlock === undefined) {
      continue;
    }

    for (const detail of collectBlocks(detailsBlock.content, "detail")) {
      if (detail.attrs.name?.trim().toLowerCase() !== pieceKey) {
        continue;
      }

      // detail 名は .val 全体で一意(projectNotchesFromVal の契約)なので、最初の一致がその piece。
      const calculation = collectFirstBlock(drawBlock.content, "calculation");

      if (calculation === undefined) {
        return { status: "no-calculation" };
      }

      return {
        status: "found",
        draw: {
          calculationOwnerContent: drawBlock.content,
          calculationContent: calculation.content,
          detailContent: detail.content
        }
      };
    }
  }

  return { status: "not-found" };
}

// <modeling> の点 id → その idObject(= calculation 点 id)。detail node の idObject は modeling 点 id を指すため、
// 合印を calculation 点へ解決するのにこの1段が要る(projectDartsFromVal の modeling 解決と同じ)。
function buildModelingToCalc(drawContent: string): ReadonlyMap<string, string> {
  const modeling = collectFirstBlock(drawContent, "modeling");
  const map = new Map<string, string>();

  if (modeling === undefined) {
    return map;
  }

  for (const point of collectSelfClosingTags(modeling.content, "point")) {
    if (point.attrs.type !== "modeling") {
      continue;
    }

    const modelingId = point.attrs.id;
    const calcId = point.attrs.idObject;

    if (modelingId !== undefined && calcId !== undefined) {
      map.set(modelingId, calcId);
    }
  }

  return map;
}

// detail の passmark node を calculation 点 id 列へ解決する(detail 内 passmark 順)。解決できない node は
// 壊れた参照として黙って落とす(防御)。
function collectDetailPassmarkAnchorCalcIds(
  detailContent: string,
  modelingToCalc: ReadonlyMap<string, string>
): readonly string[] {
  const nodesBlock = collectFirstBlock(detailContent, "nodes");

  if (nodesBlock === undefined) {
    return [];
  }

  const calcIds: string[] = [];

  for (const node of collectSelfClosingTags(nodesBlock.content, "node")) {
    if (node.attrs.passmark !== "true") {
      continue;
    }

    const modelingId = node.attrs.idObject;
    const calcId = modelingId === undefined ? undefined : modelingToCalc.get(modelingId);

    if (calcId !== undefined) {
      calcIds.push(calcId);
    }
  }

  return calcIds;
}

// calculation の点を id で引けるよう属性ごと索引する(cutSpline の spline 属性を引くため)。
function indexCalcPoints(
  calculationContent: string
): ReadonlyMap<string, Readonly<Record<string, string>>> {
  const map = new Map<string, Readonly<Record<string, string>>>();

  for (const point of collectSelfClosingTags(calculationContent, "point")) {
    const id = point.attrs.id;

    if (id !== undefined) {
      map.set(id, point.attrs);
    }
  }

  return map;
}

// calculation の spline を id で引けるよう索引する(端点 point1/point4 を引くため)。
function indexSplines(
  calculationContent: string
): ReadonlyMap<string, Readonly<Record<string, string>>> {
  const map = new Map<string, Readonly<Record<string, string>>>();

  for (const spline of collectSelfClosingTags(calculationContent, "spline")) {
    const id = spline.attrs.id;

    if (id !== undefined) {
      map.set(id, spline.attrs);
    }
  }

  return map;
}
