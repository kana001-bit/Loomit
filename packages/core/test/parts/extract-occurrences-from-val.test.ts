import { describe, expect, it } from "vitest";

import { extractOccurrencesFromValText } from "../../src/index.js";
import type { ValOccurrence } from "../../src/index.js";

// 実 cycling_knickers の outseam(spline 31)とその端点・合印・導出点を最小再現した calculation。
// 全 linearity 分岐(linear / none / nonlinear)を1本で覆う。
const OUTSEAM_CALCULATION = `<?xml version="1.0" encoding="UTF-8"?>
<pattern>
  <draw name="knickers">
    <calculation>
      <point id="1" name="A" type="single"/>
      <point angle="180" basePoint="2" id="6" length="hip_circ / 4 + #added_hips_ease" name="F" type="endLine"/>
      <point firstPoint="8" id="15" length="waist_circ / 4 + 5" name="O" secondPoint="14" type="alongLine"/>
      <point angle="270" basePoint="1" id="2" length="rise_length_side_sitting" name="B" type="endLine"/>
      <point firstPoint="8" id="18" length="4" name="d5" secondPoint="8" type="normal"/>
      <point firstPoint="8" id="8" name="N" secondPoint="1" type="pointOfIntersection"/>
      <point id="146" length="#pocket_opening_from_waist" name="A2" spline="31" type="cutSpline"/>
      <spline angle1="-45" angle2="90" id="31" length1="3" length2="15" point1="15" point4="2" type="simpleInteractive"/>
    </calculation>
  </draw>
</pattern>`;

describe("extractOccurrencesFromValText", () => {
  it("classifies linearity by occurrence type and keeps the raw expression", () => {
    // 守る仕様: 辺長への効きは occurrence type=構造で決まる。endLine/alongLine/normal=linear、cutSpline=none、
    // spline handle=nonlinear。expr は評価せず宣言式のまま持つ。
    const [draw] = extractOccurrencesFromValText(OUTSEAM_CALCULATION);

    expect(draw?.drawName).toBe("knickers");
    expect(draw?.occurrences).toEqual<ValOccurrence[]>([
      {
        pointId: "6",
        type: "endLine",
        linearity: "linear",
        expr: "hip_circ / 4 + #added_hips_ease",
        refs: ["#added_hips_ease"]
      },
      {
        pointId: "15",
        type: "alongLine",
        linearity: "linear",
        expr: "waist_circ / 4 + 5",
        refs: []
      },
      {
        pointId: "2",
        type: "endLine",
        linearity: "linear",
        expr: "rise_length_side_sitting",
        refs: []
      },
      { pointId: "18", type: "normal", linearity: "linear", expr: "4", refs: [] },
      {
        pointId: "146",
        type: "cutSpline",
        linearity: "none",
        expr: "#pocket_opening_from_waist",
        refs: ["#pocket_opening_from_waist"]
      },
      { splineId: "31", handle: "length1", linearity: "nonlinear", expr: "3", refs: [] },
      { splineId: "31", handle: "length2", linearity: "nonlinear", expr: "15", refs: [] },
      { splineId: "31", handle: "angle1", linearity: "nonlinear", expr: "-45", refs: [] },
      { splineId: "31", handle: "angle2", linearity: "nonlinear", expr: "90", refs: [] }
    ]);
  });

  it("does not emit an occurrence for derived points or base points without a length", () => {
    // 守る仕様: length を持たない点(single 基点・pointOfIntersection 導出点)は長さの操作対象でないので occurrence にしない。
    const [draw] = extractOccurrencesFromValText(OUTSEAM_CALCULATION);
    const pointIds = (draw?.occurrences ?? [])
      .filter((occurrence): occurrence is Extract<ValOccurrence, { pointId: string }> => "pointId" in occurrence)
      .map((occurrence) => occurrence.pointId);

    expect(pointIds).not.toContain("1"); // single 基点
    expect(pointIds).not.toContain("8"); // pointOfIntersection 導出点
  });

  it("collects multiple distinct increment refs in declaration order without duplicates", () => {
    // 守る仕様: refs は式中の #name を宣言順・重複なしで拾う(measurement や CurrentLength は増分でないので入れない)。
    const [draw] = extractOccurrencesFromValText(
      `<pattern><draw name="d"><calculation>
        <point id="9" length="#pocket_opening_from_waist + #pocket_opening + #pocket_opening_from_waist" type="cutSpline"/>
        <point id="10" length="CurrentLength - #leg_fly_length" type="cutSpline"/>
      </calculation></draw></pattern>`
    );

    expect(draw?.occurrences).toEqual<ValOccurrence[]>([
      {
        pointId: "9",
        type: "cutSpline",
        linearity: "none",
        expr: "#pocket_opening_from_waist + #pocket_opening + #pocket_opening_from_waist",
        refs: ["#pocket_opening_from_waist", "#pocket_opening"]
      },
      {
        pointId: "10",
        type: "cutSpline",
        linearity: "none",
        expr: "CurrentLength - #leg_fly_length",
        refs: ["#leg_fly_length"]
      }
    ]);
  });

  it("classifies an unknown length-bearing point type conservatively as none", () => {
    // 守る仕様: 未知の length 持ち point は保守的に none(誤って linear にすると数値提案へ昇格してしまう)。
    const [draw] = extractOccurrencesFromValText(
      `<pattern><draw name="d"><calculation>
        <point id="11" length="5" type="someFutureType"/>
      </calculation></draw></pattern>`
    );

    expect(draw?.occurrences).toEqual<ValOccurrence[]>([
      { pointId: "11", type: "someFutureType", linearity: "none", expr: "5", refs: [] }
    ]);
  });

  it("returns an empty occurrence list for a draw with no calculation", () => {
    // 守る仕様: calculation の無い draw でも crash せず空で返す。
    const result = extractOccurrencesFromValText(
      `<pattern><draw name="empty"><modeling/></draw></pattern>`
    );

    expect(result).toEqual([{ drawName: "empty", occurrences: [] }]);
  });
});
