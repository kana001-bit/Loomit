import { describe, expect, it } from "vitest";

import { projectDartsFromValText } from "../../src/index.js";

describe("projectDartsFromValText", () => {
  it("projects a 5-point dart path that repeats its anchor point", () => {
    // 守る仕様: Valentina の 5 点 dart path は、先頭終端の anchor を除いて legs と apex を抽出できる。
    const result = projectDartsFromValText(
      `<?xml version="1.0" encoding="UTF-8"?>
<pattern>
  <draw name="bodice">
    <calculation>
      <point id="148" name="WaistAnchor" type="alongLine" length="CurrentLength/2"/>
      <point id="151" name="WaistApex" type="alongLine" length="CurrentLength*2/3"/>
      <point id="152" name="WaistLegLeft" type="alongLine" length="#dart / 2"/>
      <point id="153" name="WaistLegRight" type="alongLine" length="Line_A42_A45"/>
    </calculation>
    <modeling>
      <point id="154" idObject="148" inUse="true" type="modeling"/>
      <point id="155" idObject="152" inUse="true" type="modeling"/>
      <point id="156" idObject="151" inUse="true" type="modeling"/>
      <point id="157" idObject="153" inUse="true" type="modeling"/>
      <point id="158" idObject="148" inUse="true" type="modeling"/>
      <path id="159" inUse="true" name="dart" type="2">
        <nodes>
          <node idObject="154" type="NodePoint"/>
          <node idObject="155" type="NodePoint"/>
          <node idObject="156" type="NodePoint"/>
          <node idObject="157" type="NodePoint"/>
          <node idObject="158" type="NodePoint"/>
        </nodes>
      </path>
    </modeling>
  </draw>
</pattern>`,
      {
        filePath: "fixture.val"
      }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.darts).toEqual({
      "val:bodice:dart:159": {
        apex_ref: "val:point#bodice/WaistApex",
        width_formula: "#dart",
        intake_length_formula: "CurrentLength*2/3",
        legs: {
          left_ref: "val:point#bodice/WaistLegLeft",
          right_ref: "val:point#bodice/WaistLegRight"
        }
      }
    });
  });

  it("infers the full width formula from a `* 0.5` leg length", () => {
    // 守る仕様: leg length が `x * 0.5`(半分)でも全幅の式 x を width_formula として復元する。
    //           `0.05` のような別係数を 0.5 と誤認しない。
    const result = projectDartsFromValText(
      `<?xml version="1.0" encoding="UTF-8"?>
<pattern>
  <draw name="bodice">
    <calculation>
      <point id="10" name="LegLeft" type="endLine" length="waist_dart * 0.5"/>
      <point id="11" name="Apex" type="alongLine" length="CurrentLength/2"/>
      <point id="12" name="LegRight" type="single"/>
    </calculation>
    <modeling>
      <point id="20" idObject="10" inUse="true" type="modeling"/>
      <point id="21" idObject="11" inUse="true" type="modeling"/>
      <point id="22" idObject="12" inUse="true" type="modeling"/>
      <path id="30" inUse="true" name="dart" type="2">
        <nodes>
          <node idObject="20" type="NodePoint"/>
          <node idObject="21" type="NodePoint"/>
          <node idObject="22" type="NodePoint"/>
        </nodes>
      </path>
    </modeling>
  </draw>
</pattern>`,
      {
        filePath: "fixture.val"
      }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.darts).toEqual({
      "val:bodice:dart:30": {
        apex_ref: "val:point#bodice/Apex",
        width_formula: "waist_dart",
        intake_length_formula: "CurrentLength/2",
        legs: {
          left_ref: "val:point#bodice/LegLeft",
          right_ref: "val:point#bodice/LegRight"
        }
      }
    });
  });
});
