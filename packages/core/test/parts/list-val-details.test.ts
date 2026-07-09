import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { listValDetailsFromFile, listValDetailsFromText } from "../../src/index.js";

describe("listValDetailsFromText", () => {
  it("lists detail piece names for each draw", () => {
    // 守る仕様: garment-aware add の最初の土台として、.val の read-only detail 一覧を draw ごとに取れる。
    const result = listValDetailsFromText(
      `<?xml version="1.0" encoding="UTF-8"?>
<pattern>
  <draw name="pattern">
    <details>
      <detail id="53" name="back"></detail>
      <detail id="77" name="front"></detail>
      <detail id="236" name="sleeve"></detail>
    </details>
  </draw>
</pattern>`
    );

    expect(result).toEqual({
      draws: [
        {
          drawName: "pattern",
          details: ["back", "front", "sleeve"]
        }
      ],
      totalDetails: 3
    });
  });

  it("keeps a draw even when it has zero detail pieces", () => {
    // 守る仕様: 0-detail .val も silent にせず、draw は見つかったが piece は無いと案内できる情報を返す。
    const result = listValDetailsFromText(
      `<?xml version="1.0" encoding="UTF-8"?>
<pattern>
  <draw name="blouse">
    <details/>
  </draw>
</pattern>`
    );

    expect(result).toEqual({
      draws: [
        {
          drawName: "blouse",
          details: []
        }
      ],
      totalDetails: 0
    });
  });
});

describe("listValDetailsFromFile", () => {
  it("reads detail names from a real .val fixture", async () => {
    // 守る仕様: 実ファイル経由でも detail 名をそのまま返し、CLI が取り込み前一覧に使える。
    const filePath = fileURLToPath(
      new URL("../fixtures/load-files/valid-part-projected-notches/source.val", import.meta.url)
    );

    const result = await listValDetailsFromFile(filePath);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value.draws).toEqual([
      {
        drawName: "block",
        details: []
      }
    ]);
  });

  it("reports a diagnostic when the .val file cannot be read", async () => {
    // 守る仕様: detail 一覧の read 失敗は explainable diagnostic にして、usage error のように黙って落とさない。
    const missingPath = join(fileURLToPath(new URL("../fixtures/", import.meta.url)), "missing.val");

    const result = await listValDetailsFromFile(missingPath);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "PART_SOURCE_VAL_READ_FAILED"
    );
  });
});
