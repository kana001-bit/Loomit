import { createDiagnostic } from "../diagnostics/diagnostic.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { extractOccurrencesFromCalculationContent } from "./extractOccurrencesFromVal.js";
import type { ValOccurrence } from "./extractOccurrencesFromVal.js";
import { notchTypeFromPassmarkLine } from "./notchType.js";
import type { NotchType } from "./notchType.js";
import { collectBlocks, collectFirstBlock, collectSelfClosingTags } from "./valXml.js";

// notch 単位のグループ(applicable 用の view)。dependsOn がフラットに混ぜていた「どの notch がどの spline を錨付け、
// その長さ候補はどれか」を notch ごとに束ね直す。幾何評価はせず .val の calculation グラフ構造だけで決まる。
export interface EdgeNotch {
  // piece 輪郭順(detail <nodes> の passmark 出現順・0 始まり)。位置でなく順序で両方向マッチする用
  // (projectNotchesFromVal の order と同義)。idObject が解決できず落ちた passmark も番号を消費するので、
  // 残った notch の相対順序は保たれる。
  readonly order: number;
  // .val の passmarkLine 生値(vMark/tMark/one…)。属性が無ければ省く(発明しない)。
  readonly rawPassmarkLine?: string;
  // rawPassmarkLine を Seamlint の種別 enum に正規化したもの。写像できなければ省く(弱い tie-breaker)。
  readonly notchType?: NotchType;
  // 合印が載る calculation 点(cutSpline 点)の id。
  readonly anchorPointId: string;
  // 合印が錨付ける spline の id(cutSpline のときだけ。直線上の合印など spline を持たなければ省く)。
  readonly splineId?: string;
  // その spline の長さ候補 occurrence(端点 point1/point4 ＋ 制御ハンドル)。spline が無ければ空。
  // dependsOn にも同じ occurrence が出るが、こちらは notch 単位にグループ化した applicable 用の view。
  readonly lengthCandidates: readonly ValOccurrence[];
}

export interface EdgeOccurrenceResult {
  readonly occurrences: readonly ValOccurrence[];
  readonly notches: readonly EdgeNotch[];
  readonly diagnostics: readonly Diagnostic[];
}

// 1つの piece(detail=DXF BLOCK)の合印が載るカーブ経由で、その seam 辺の長さに効きうる occurrence を集める。
//
// 経路(= [C1] 手追いと同じ): detail の passmark node.idObject → <modeling> の同 id の点 → その idObject = calculation 点
//   → calculation 点が cutSpline なら spline 属性で通過カーブを特定 → そのカーブ(spline)の端点(point1/point4)と
//     制御ハンドル(length1/2・angle1/2)の occurrence を集める。
//
// 返り値は2つの view: occurrences(part 単位フラット・provenance-only 用)と notches(合印ごとに「錨 spline → 長さ候補」を
//   束ねた applicable 用。同じ occurrence を notch 単位に再編成しただけで、幾何評価は足していない)。
//
// 重要な限界(= [C6], provenance-only では踏まない): connector は BLOCK 全体を指し、実際に測る辺は Seamlint が
//   発見する。よってここで返すのは「この piece の合印が載るカーブ上の occurrence」であって「測定辺そのもの」ではない。
//   数値提案(applicable)を出す段では Seamlint の測定辺端点と突き合わせて確定が要る(notches の順序/種別で突き合わせる)。
export function collectEdgeOccurrencesFromValText(
  source: string,
  options: { readonly piece: string }
): EdgeOccurrenceResult {
  const pieceKey = options.piece.trim().toLowerCase();
  const lookup = findDrawWithDetail(source, pieceKey);

  if (lookup.status === "not-found") {
    return {
      occurrences: [],
      notches: [],
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

  const diagnostics: Diagnostic[] = [];

  // 同名 detail は契約違反(piece 名 = DXF BLOCK identity は一意)。calc の有無や採否に関係なく、違反そのものを先に surface する
  // (先頭一致が calc 欠落でも重複違反を隠さない・後続に有効な detail がある事実を握りつぶさない)。採用は first-wins。
  if (lookup.duplicate) {
    diagnostics.push(
      createDiagnostic({
        severity: "warning",
        code: "PART_SOURCE_VAL_DUPLICATE_PIECE",
        message:
          "同じ名前の detail(型紙ピース)が複数あります。piece 名は DXF BLOCK の identity として一意である必要があるため、最初の detail の occurrence だけを採用しました。 / Found more than one detail with the same name; piece names must be unique because they identify DXF blocks, so only the first detail's occurrences were kept.",
        target: options.piece,
        suggestion: [
          "各型紙ピースの detail 名を .val 全体で一意にしてください。 / Give every pattern piece a detail name that is unique across the .val."
        ]
      })
    );
  }

  // piece は在るが採用した(先頭の)detail の draw に <calculation> が無い = .val が不完全。piece 名は正しいので
  // 「見つからない」とは別の案内にする。重複警告があれば併記される(重複が根因、calc 欠落はその症状のこともある)。
  if (lookup.status === "no-calculation") {
    diagnostics.push(
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
    );

    return { occurrences: [], notches: [], diagnostics };
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

  const passmarks = collectDetailPassmarks(draw.detailContent, modelingToCalc);
  const splineIds: string[] = [];

  for (const passmark of passmarks) {
    // 合印そのものが載る点の occurrence(cutSpline=linearity none 等)。辺上の点なので含める。
    add(pointOccurrenceById.get(passmark.anchorCalcId));

    // cutSpline なら通過カーブを控える(端点・ハンドルは後でまとめて追加)。
    const splineId = calcPointById.get(passmark.anchorCalcId)?.spline;

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

  // notches: dependsOn がフラットに畳んだ「notch → その spline → 長さ候補」を notch 単位に束ね直す(applicable 用 view)。
  // dependsOn は上でそのまま維持しているので provenance-only 消費者には影響しない(純追加)。
  const notches: EdgeNotch[] = passmarks.map((passmark) => {
    const splineId = calcPointById.get(passmark.anchorCalcId)?.spline;
    const notchType =
      passmark.passmarkLine === undefined ? undefined : notchTypeFromPassmarkLine(passmark.passmarkLine);

    return {
      order: passmark.order,
      // 生値/正規化は「有るときだけ」載せる(発明しない・写像できないものは省く)。
      ...(passmark.passmarkLine === undefined ? {} : { rawPassmarkLine: passmark.passmarkLine }),
      ...(notchType === undefined ? {} : { notchType }),
      anchorPointId: passmark.anchorCalcId,
      // spline に載らない合印(直線上等)は splineId を持たず、長さ候補も空(applicable は昇格しない)。
      ...(splineId === undefined ? {} : { splineId }),
      lengthCandidates:
        splineId === undefined
          ? []
          : collectSplineLengthCandidates(
              splineId,
              splineById,
              pointOccurrenceById,
              splineOccurrencesById
            )
    };
  });

  return { occurrences: selected, notches, diagnostics };
}

// 1本の spline の長さ候補 occurrence(端点 point1/point4 ＋ 制御ハンドル length1/2・angle1/2)を集める。
// dependsOn 構築と同じ選び方だが、notch 単位に閉じて重複を畳む(2つの候補が同一 occurrence を指しても1度だけ)。
function collectSplineLengthCandidates(
  splineId: string,
  splineById: ReadonlyMap<string, Readonly<Record<string, string>>>,
  pointOccurrenceById: ReadonlyMap<string, ValOccurrence>,
  splineOccurrencesById: ReadonlyMap<string, readonly ValOccurrence[]>
): readonly ValOccurrence[] {
  const spline = splineById.get(splineId);
  const candidates: ValOccurrence[] = [];
  const seen = new Set<string>();
  const push = (occurrence: ValOccurrence | undefined): void => {
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
    candidates.push(occurrence);
  };

  push(pointOccurrenceById.get(spline?.point1 ?? ""));
  push(pointOccurrenceById.get(spline?.point4 ?? ""));
  for (const handleOccurrence of splineOccurrencesById.get(splineId) ?? []) {
    push(handleOccurrence);
  }

  return candidates;
}

interface DrawWithDetail {
  // detail/modeling/calculation を含む <draw> の中身。modeling マップ構築に使う。
  readonly calculationOwnerContent: string;
  readonly calculationContent: string;
  readonly detailContent: string;
}

// piece 探索の結果。「見つからない」と「見つかったが calculation が無い(=不完全な .val)」を分けて、
// 呼び出し側が別の diagnostic を出せるようにする(前者は piece 名を疑え、後者は piece 名は正しい)。
// found の duplicate は「同名 detail が2つ以上あった」= 契約違反(piece 名は一意)を呼び出し側に伝えるフラグ。
type DrawLookup =
  | { readonly status: "found"; readonly draw: DrawWithDetail; readonly duplicate: boolean }
  | { readonly status: "no-calculation"; readonly duplicate: boolean }
  | { readonly status: "not-found" };

// piece(detail 名)を case-insensitive で持つ draw を探す。detail 名照合は Seamlint の BLOCK 照合(大小無視)と
// 揃える(projectNotchesFromVal と同じ約束)。契約上 detail 名は一意だが、違反(同名複数)を検出できるよう全 detail を
// 走査して一致数も数える。採用は最初の一致(projectNotchesFromVal と同じ first-wins)。
function findDrawWithDetail(source: string, pieceKey: string): DrawLookup {
  let firstMatch: { readonly draw?: DrawWithDetail; readonly noCalculation: boolean } | undefined;
  let matchCount = 0;

  for (const drawBlock of collectBlocks(source, "draw")) {
    const detailsBlock = collectFirstBlock(drawBlock.content, "details");

    if (detailsBlock === undefined) {
      continue;
    }

    for (const detail of collectBlocks(detailsBlock.content, "detail")) {
      if (detail.attrs.name?.trim().toLowerCase() !== pieceKey) {
        continue;
      }

      matchCount += 1;

      if (firstMatch === undefined) {
        const calculation = collectFirstBlock(drawBlock.content, "calculation");
        firstMatch =
          calculation === undefined
            ? { noCalculation: true }
            : {
                noCalculation: false,
                draw: {
                  calculationOwnerContent: drawBlock.content,
                  calculationContent: calculation.content,
                  detailContent: detail.content
                }
              };
      }
    }
  }

  if (firstMatch === undefined) {
    return { status: "not-found" };
  }

  // matchCount は全 detail を走査した総一致数なので、先頭が calc 欠落でも重複(>1)を正しく検出できる。
  if (firstMatch.draw === undefined) {
    return { status: "no-calculation", duplicate: matchCount > 1 };
  }

  return { status: "found", draw: firstMatch.draw, duplicate: matchCount > 1 };
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

// detail の passmark node を解決する(detail 内 passmark 順)。各 passmark について輪郭順(order)・錨点の calculation 点 id・
// passmarkLine 生値を持って返す。order は passmark 出現順で、idObject が解決できず落ちた node も番号を消費するので、
// 残った passmark の相対順序は保たれる(Truer が測定辺の subset を順序で突き合わせる用)。解決できない node は
// 壊れた参照として黙って落とす(防御・従来の anchor-calc-id 解決と同じ)。
interface DetailPassmark {
  readonly order: number;
  readonly anchorCalcId: string;
  readonly passmarkLine?: string;
}

function collectDetailPassmarks(
  detailContent: string,
  modelingToCalc: ReadonlyMap<string, string>
): readonly DetailPassmark[] {
  const nodesBlock = collectFirstBlock(detailContent, "nodes");

  if (nodesBlock === undefined) {
    return [];
  }

  const passmarks: DetailPassmark[] = [];
  let order = 0;

  for (const node of collectSelfClosingTags(nodesBlock.content, "node")) {
    if (node.attrs.passmark !== "true") {
      continue;
    }

    // order は passmark 出現順(輪郭順)。解決可否に関係なく番号を消費する。
    const currentOrder = order;
    order += 1;

    const modelingId = node.attrs.idObject;
    const calcId = modelingId === undefined ? undefined : modelingToCalc.get(modelingId);

    if (calcId === undefined) {
      continue;
    }

    // passmarkLine が空文字なら「種別なし」として省く(projectNotchesFromVal の type と同じ約束)。
    const rawPassmarkLine =
      node.attrs.passmarkLine !== undefined && node.attrs.passmarkLine.trim() !== ""
        ? node.attrs.passmarkLine
        : undefined;

    passmarks.push({
      order: currentOrder,
      anchorCalcId: calcId,
      ...(rawPassmarkLine === undefined ? {} : { passmarkLine: rawPassmarkLine })
    });
  }

  return passmarks;
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
