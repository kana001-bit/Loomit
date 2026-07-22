import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readIncrementsFromValFile, readIncrementsFromValText } from "../../src/index.js";

describe("readIncrementsFromValText", () => {
  it("reads name, value and note while keeping the leading #", () => {
    // 守る仕様: <increments> の宣言を name(先頭#付き)・value(formula)・note(description)として宣言順に射影する。
    const result = readIncrementsFromValText(
      `<?xml version="1.0" encoding="UTF-8"?>
<pattern>
  <increments>
    <increment formula="14" name="#fly_length"/>
    <increment description="depth of pocket from waist" formula="40" name="#pocket_depth"/>
  </increments>
</pattern>`
    );

    expect(result).toEqual([
      { name: "#fly_length", value: "14" },
      { name: "#pocket_depth", value: "40", note: "depth of pocket from waist" }
    ]);
  });

  it("represents a formula-less increment as an empty value and still carries its note", () => {
    // 守る仕様: formula 属性を持たない増分(既定 0 のツマミ)は value="" で保持し、description は note に素通しする。
    const result = readIncrementsFromValText(
      `<pattern>
  <increments>
    <increment description="this knob can be used to make them baggier" name="#added_hips_ease"/>
  </increments>
</pattern>`
    );

    expect(result).toEqual([
      { name: "#added_hips_ease", value: "", note: "this knob can be used to make them baggier" }
    ]);
  });

  it("returns an empty list when there is no increments block", () => {
    // 守る仕様: <increments> の無い .val でも crash せず空配列を返す(増分は正常に存在しないことがある)。
    const result = readIncrementsFromValText(
      `<pattern>
  <draw name="knickers"><calculation/></draw>
</pattern>`
    );

    expect(result).toEqual([]);
  });

  it("skips an increment with no name", () => {
    // 守る仕様: 名前の無い増分は params 辞書のキーにできないため落とす(壊れた .val に対する防御)。
    const result = readIncrementsFromValText(
      `<pattern>
  <increments>
    <increment formula="5"/>
    <increment formula="10" name="#knee_overlap"/>
  </increments>
</pattern>`
    );

    expect(result).toEqual([{ name: "#knee_overlap", value: "10" }]);
  });
});

describe("readIncrementsFromValFile", () => {
  it("reads the full increments block from a real cycling_knickers-shaped fixture", async () => {
    // 守る仕様: 実データ形状の .val から全増分を欠落なく射影する(payload params 辞書の素の回帰アンカー)。
    const filePath = fileURLToPath(
      new URL("../fixtures/val-increments/source.val", import.meta.url)
    );

    const result = await readIncrementsFromValFile(filePath);

    expect(result.diagnostics).toEqual([]);
    expect(result.increments).toEqual([
      {
        name: "#added_hips_ease",
        value: "",
        note: "The original knickers (added_hips_ease = 0) are pretty fitted, this knob can be used to make them baggier."
      },
      { name: "#knee_overlap", value: "10" },
      { name: "#waistband_height", value: "5" },
      { name: "#knee_band_height", value: "4" },
      { name: "#fly_length", value: "14" },
      { name: "#fly_facing_width", value: "4" },
      { name: "#leg_fly_length", value: "10" },
      { name: "#leg_fly_facing_width", value: "2" },
      { name: "#pocket_depth", value: "40", note: "depth of pocket from waist" },
      { name: "#pocket_width", value: "15", note: "pocket width from hips" },
      { name: "#pocket_opening_from_waist", value: "5" },
      { name: "#pocket_opening", value: "15" }
    ]);
  });

  it("returns an empty list without a diagnostic when the .val is absent", async () => {
    // 守る仕様: source.val が無いのは正常系(未コミット等)。ENOENT は silent に空で返し警告を出さない。
    const missingPath = join(fileURLToPath(new URL("../fixtures/", import.meta.url)), "missing.val");

    const result = await readIncrementsFromValFile(missingPath);

    expect(result.increments).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
