import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadProjectedPart } from "../../src/index.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/load-files");

describe("loadProjectedPart", () => {
  it("projects darts from source.val when part.loom omits them", async () => {
    // 守る仕様: darts を持たず files.source がある part は、source.val の dart path から read-only に射影する。
    const result = await loadProjectedPart(join(fixturesRoot, "valid-part-projected-darts/part.loom"));

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.darts : {}).toEqual({
      "val:block:dart:80": {
        apex_ref: "val:point#block/ShoulderApex",
        width_formula: "dart_width_shoulder",
        intake_length_formula: "CurrentLength/2",
        legs: {
          left_ref: "val:point#block/ShoulderLeft",
          right_ref: "val:point#block/ShoulderRight"
        }
      }
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps inline darts and does not read source.val", async () => {
    // 守る仕様: part.loom が darts を明示していれば射影せずそのまま使う。
    const result = await loadProjectedPart(join(fixturesRoot, "valid-part-with-darts/part.loom"));

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.darts?.waist_front.width_mm : 0).toBe(30);
    expect(result.diagnostics).toEqual([]);
  });

  it("is silent when the referenced source.val is absent", async () => {
    // 守る仕様(案E): source.val が存在しないのは正常系。射影は空で、警告も出さない。
    const result = await loadProjectedPart(join(fixturesRoot, "valid-part/part.loom"));

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.darts : {}).toBeUndefined();
    expect(result.diagnostics).toEqual([]);
  });
});
