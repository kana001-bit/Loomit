import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  collectEdgeOccurrencesFromValText,
  extractOccurrencesFromValText,
  listValDetailsFromText,
  projectDartsFromValText,
  projectNotchesFromValText,
  readIncrementsFromValText
} from "../../src/index.js";

// #2(valXml を実 XML パーサへ差し替え)の安全網。valXml が支える全射影の、実 .val に対する出力を golden で固定する。
// パーサ差し替え後にこの snapshot が一致すれば「実データの挙動不変」が確認でき、ずれたら差分を精査する(regex→parser の唯一の gate)。
const valPath = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/cycling-knickers-val/source.val");

describe("valXml projections golden (real cycling_knickers.val)", () => {
  it("pins every valXml-backed projection so an XML-parser swap can be verified byte-for-byte", async () => {
    // 守る仕様: valXml(現行 regex)が支える 6 射影の実 .val 出力を丸ごと golden 固定する。実装差し替えで実データの射影が
    // 1 バイトでも変われば落ちる = 挙動不変の gate。診断の target を安定させるため filePath は固定値を渡す。
    const source = await readFile(valPath, "utf8");
    const filePath = "parts/knickers/source.val";

    const golden = {
      increments: readIncrementsFromValText(source),
      details: listValDetailsFromText(source),
      occurrences: extractOccurrencesFromValText(source),
      edgeFront: collectEdgeOccurrencesFromValText(source, { piece: "front" }),
      edgeBack: collectEdgeOccurrencesFromValText(source, { piece: "back" }),
      notches: projectNotchesFromValText(source, { filePath }),
      darts: projectDartsFromValText(source, { filePath })
    };

    await expect(`${JSON.stringify(golden, null, 2)}\n`).toMatchFileSnapshot(
      "./__snapshots__/valxml-projections-cycling-knickers.json"
    );
  });
});
