import { describe, expect, it } from "vitest";

import { collectEdgeOccurrencesFromValText } from "../../src/index.js";
import type { ValOccurrence } from "../../src/index.js";

// 実 cycling_knickers の front outseam を最小再現。合印2個が spline 31 / 33 に載り、各カーブの端点(15/2, 27/25)と
// 制御ハンドルへ辿れる。detail node.idObject(169/178) → modeling → calculation(146/177)の2段解決も含む。
const FRONT_OUTSEAM = `<?xml version="1.0" encoding="UTF-8"?>
<pattern>
  <draw name="knickers">
    <calculation>
      <point firstPoint="8" id="15" length="waist_circ / 4 + 5" name="O" secondPoint="14" type="alongLine"/>
      <point angle="270" basePoint="1" id="2" length="rise_length_side_sitting" name="B" type="endLine"/>
      <point firstPoint="3" id="27" length="3" name="X" secondPoint="13" type="alongLine"/>
      <point firstPoint="5" id="25" length="6.5" name="W" secondPoint="9" type="alongLine"/>
      <point id="146" length="#pocket_opening_from_waist" name="A2" spline="31" type="cutSpline"/>
      <point id="177" length="CurrentLength - #leg_fly_length" name="A12" spline="33" type="cutSpline"/>
      <spline angle1="-45" angle2="90" id="31" length1="3" length2="15" point1="15" point4="2" type="simpleInteractive"/>
      <spline angle1="260" angle2="70" id="33" length1="5" length2="5" point1="27" point4="25" type="simpleInteractive"/>
    </calculation>
    <modeling>
      <point id="169" idObject="146" inUse="true" type="modeling"/>
      <point id="178" idObject="177" inUse="true" type="modeling"/>
    </modeling>
    <details>
      <detail id="62" name="front">
        <nodes>
          <node idObject="169" passmark="true" passmarkLine="vMark" type="NodePoint"/>
          <node idObject="178" passmark="true" passmarkLine="tMark" type="NodePoint"/>
        </nodes>
      </detail>
    </details>
  </draw>
</pattern>`;

describe("collectEdgeOccurrencesFromValText", () => {
  it("collects occurrences on the curves that carry a piece's notches (front outseam)", () => {
    // 守る仕様: piece の合印 → 通過カーブ(spline)→ 端点+ハンドルの occurrence を集める。合印点自身(cutSpline=none)も
    // 辺上の点として含める。順序は 合印点 → カーブごとに 端点(point1,point4)→ ハンドル(length1,length2,angle1,angle2)。
    const result = collectEdgeOccurrencesFromValText(FRONT_OUTSEAM, { piece: "front" });

    expect(result.diagnostics).toEqual([]);
    expect(result.occurrences).toEqual<ValOccurrence[]>([
      { pointId: "146", type: "cutSpline", linearity: "none", expr: "#pocket_opening_from_waist", refs: ["#pocket_opening_from_waist"] },
      { pointId: "177", type: "cutSpline", linearity: "none", expr: "CurrentLength - #leg_fly_length", refs: ["#leg_fly_length"] },
      { pointId: "15", type: "alongLine", linearity: "linear", expr: "waist_circ / 4 + 5", refs: [] },
      { pointId: "2", type: "endLine", linearity: "linear", expr: "rise_length_side_sitting", refs: [] },
      { splineId: "31", handle: "length1", linearity: "nonlinear", expr: "3", refs: [] },
      { splineId: "31", handle: "length2", linearity: "nonlinear", expr: "15", refs: [] },
      { splineId: "31", handle: "angle1", linearity: "nonlinear", expr: "-45", refs: [] },
      { splineId: "31", handle: "angle2", linearity: "nonlinear", expr: "90", refs: [] },
      { pointId: "27", type: "alongLine", linearity: "linear", expr: "3", refs: [] },
      { pointId: "25", type: "alongLine", linearity: "linear", expr: "6.5", refs: [] },
      { splineId: "33", handle: "length1", linearity: "nonlinear", expr: "5", refs: [] },
      { splineId: "33", handle: "length2", linearity: "nonlinear", expr: "5", refs: [] },
      { splineId: "33", handle: "angle1", linearity: "nonlinear", expr: "260", refs: [] },
      { splineId: "33", handle: "angle2", linearity: "nonlinear", expr: "70", refs: [] }
    ]);
  });

  it("matches the piece name case-insensitively (DXF block matching)", () => {
    // 守る仕様: piece 照合は Seamlint の BLOCK 照合と同じ大小無視。files.piece="FRONT" でも detail name="front" に解決する。
    const result = collectEdgeOccurrencesFromValText(FRONT_OUTSEAM, { piece: "FRONT" });

    expect(result.diagnostics).toEqual([]);
    expect(result.occurrences.length).toBe(14);
  });

  it("deduplicates a curve shared by two notches", () => {
    // 守る仕様: 2つの合印が同じ spline に載る場合、その端点・ハンドルは一度だけ集める(重複しない)。
    const shared = `<pattern><draw name="d">
      <calculation>
        <point id="15" length="waist_circ / 4 + 5" type="alongLine"/>
        <point id="2" length="rise_length_side_sitting" type="endLine"/>
        <point id="146" length="#pocket_opening_from_waist" spline="31" type="cutSpline"/>
        <point id="147" length="#pocket_opening" spline="31" type="cutSpline"/>
        <spline angle1="-45" angle2="90" id="31" length1="3" length2="15" point1="15" point4="2" type="simpleInteractive"/>
      </calculation>
      <modeling>
        <point id="169" idObject="146" type="modeling"/>
        <point id="170" idObject="147" type="modeling"/>
      </modeling>
      <details><detail name="front"><nodes>
        <node idObject="169" passmark="true" type="NodePoint"/>
        <node idObject="170" passmark="true" type="NodePoint"/>
      </nodes></detail></details>
    </draw></pattern>`;

    const result = collectEdgeOccurrencesFromValText(shared, { piece: "front" });

    // 合印点2 + 端点2 + spline31 のハンドル4 = 8。端点/ハンドルは共有 spline なので1度だけ。
    expect(result.occurrences.length).toBe(8);
    const splineHandleCount = result.occurrences.filter(
      (occurrence): occurrence is Extract<ValOccurrence, { splineId: string }> => "splineId" in occurrence
    ).length;
    expect(splineHandleCount).toBe(4);
  });

  it("ignores non-passmark contour nodes", () => {
    // 守る仕様: passmark でない contour node は合印でないため、その点は辺 occurrence の起点にしない。
    const withContourNode = `<pattern><draw name="d">
      <calculation>
        <point id="15" length="waist_circ / 4 + 5" type="alongLine"/>
        <point id="2" length="rise_length_side_sitting" type="endLine"/>
        <point id="146" length="#pocket_opening_from_waist" spline="31" type="cutSpline"/>
        <point id="999" length="hip_circ / 4" type="endLine"/>
        <spline angle1="-45" angle2="90" id="31" length1="3" length2="15" point1="15" point4="2" type="simpleInteractive"/>
      </calculation>
      <modeling>
        <point id="169" idObject="146" type="modeling"/>
        <point id="900" idObject="999" type="modeling"/>
      </modeling>
      <details><detail name="front"><nodes>
        <node idObject="169" passmark="true" type="NodePoint"/>
        <node idObject="900" type="NodePoint"/>
      </nodes></detail></details>
    </draw></pattern>`;

    const result = collectEdgeOccurrencesFromValText(withContourNode, { piece: "front" });
    const pointIds = result.occurrences
      .filter((occurrence): occurrence is Extract<ValOccurrence, { pointId: string }> => "pointId" in occurrence)
      .map((occurrence) => occurrence.pointId);

    expect(pointIds).not.toContain("999");
  });

  it("reports a diagnostic when the piece is not in the .val", () => {
    // 守る仕様: 指定 piece が .val に無いときは黙って空にせず explainable diagnostic を出す。
    const result = collectEdgeOccurrencesFromValText(FRONT_OUTSEAM, { piece: "sleeve" });

    expect(result.occurrences).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "PART_SOURCE_VAL_PIECE_NOT_FOUND"
    );
  });

  it("selects occurrences from the draw that actually holds the piece, not the first same-named draw", () => {
    // 守る仕様: occurrence は piece を含む draw の calculation から取る。同名(未命名で既定 "draw" に落ちる場合を含む)draw が
    // 複数あっても、名前一致の先頭でなく piece を持つ draw を使う。
    const twoUnnamedDraws = `<pattern>
      <draw>
        <calculation>
          <point id="15" length="unrelated_measurement" type="endLine"/>
        </calculation>
        <details><detail name="back"><nodes/></detail></details>
      </draw>
      <draw>
        <calculation>
          <point id="15" length="waist_circ / 4 + 5" type="alongLine"/>
          <point id="2" length="rise_length_side_sitting" type="endLine"/>
          <point id="146" length="#pocket_opening_from_waist" spline="31" type="cutSpline"/>
          <spline angle1="-45" angle2="90" id="31" length1="3" length2="15" point1="15" point4="2" type="simpleInteractive"/>
        </calculation>
        <modeling><point id="169" idObject="146" type="modeling"/></modeling>
        <details><detail name="front"><nodes>
          <node idObject="169" passmark="true" type="NodePoint"/>
        </nodes></detail></details>
      </draw>
    </pattern>`;

    const result = collectEdgeOccurrencesFromValText(twoUnnamedDraws, { piece: "front" });

    expect(result.diagnostics).toEqual([]);
    // 合印点146 + 端点15/2 + spline31 ハンドル4 = 7。1つ目の draw の point15("unrelated_measurement")は混ざらない。
    expect(result.occurrences.length).toBe(7);
    const point15 = result.occurrences.find(
      (occurrence): occurrence is Extract<ValOccurrence, { pointId: string }> =>
        "pointId" in occurrence && occurrence.pointId === "15"
    );
    expect(point15?.expr).toBe("waist_circ / 4 + 5");
  });

  it("distinguishes a piece whose draw has no calculation from a missing piece", () => {
    // 守る仕様: piece は在るが draw に <calculation> が無いときは PIECE_NOT_FOUND ではなく CALCULATION_MISSING を出す
    // (piece 名は正しいので「files.piece を確認」と誤誘導しない)。
    const noCalculation = `<pattern><draw name="knickers">
      <modeling><point id="169" idObject="146" type="modeling"/></modeling>
      <details><detail name="front"><nodes>
        <node idObject="169" passmark="true" type="NodePoint"/>
      </nodes></detail></details>
    </draw></pattern>`;

    const result = collectEdgeOccurrencesFromValText(noCalculation, { piece: "front" });

    expect(result.occurrences).toEqual([]);
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain("PART_SOURCE_VAL_CALCULATION_MISSING");
    expect(codes).not.toContain("PART_SOURCE_VAL_PIECE_NOT_FOUND");
  });
});
