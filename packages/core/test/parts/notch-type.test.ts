import { describe, expect, it } from "vitest";

import { notchTypeFromPassmarkLine } from "../../src/index.js";

describe("notchTypeFromPassmarkLine", () => {
  it("collapses the layer-4 family (V marks and line-count marks) to v", () => {
    // 守る仕様: Valentina の layer4 一族(External/InternalVMark ＋ One/Two/ThreeLines)は DXF 上で Seamlint が形状区別せず
    // layer4 の POINT として読むので、Loomit も全部 "v" に正規化する(Seamlint が比較できる粒度に合わせる)。
    for (const raw of ["vMark", "vMark2", "one", "two", "three"]) {
      expect(notchTypeFromPassmarkLine(raw)).toBe("v");
    }
  });

  it("maps the distinct-layer marks to t / castle / check / u", () => {
    // 守る仕様: 別レイヤの合印はそれぞれの enum に写像する(tMark→t / boxMark→castle / checkMark→check / uMark→u)。
    // 出所は Valentina def.cpp(.val 文字列)＋vdxfengine.cpp(layer)。
    expect(notchTypeFromPassmarkLine("tMark")).toBe("t");
    expect(notchTypeFromPassmarkLine("boxMark")).toBe("castle");
    expect(notchTypeFromPassmarkLine("checkMark")).toBe("check");
    expect(notchTypeFromPassmarkLine("uMark")).toBe("u");
  });

  it("returns undefined for unknown or empty values (omit notchType, do not invent)", () => {
    // 守る仕様(must-not-fire): 写像できない値は undefined。呼び出し側は notchType を省き、種別 tie-break に使わず順序で拾う。
    expect(notchTypeFromPassmarkLine("")).toBeUndefined();
    expect(notchTypeFromPassmarkLine("wat")).toBeUndefined();
    // 大小・別綴りは写像しない(def.cpp のシリアライズ文字列と厳密一致のみ)。
    expect(notchTypeFromPassmarkLine("VMARK")).toBeUndefined();
  });
});
