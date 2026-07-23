import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  extractOccurrencesFromValText,
  listValDetailsFromText,
  projectDartsFromValText,
  projectNotchesFromValText,
  readIncrementsFromValText
} from "../../src/index.js";

// #2(valXml を実 XML パーサへ差し替え)の安全網・多様版。CC0 パブリックドメインの実 .val 群
// (github.com/.../blocks: 歴史的パターン集)で、valXml が支える射影を golden 固定する。detail 数 0〜8・サイズ 6〜58KB と
// 構造が多様なので、パーサ差し替えを diverse な実データで gate できる(cycling_knickers 単体では見えない揺れも捕まえる)。
// piece 非依存の 5 射影に絞る(collectEdge は piece 指定が要るので cycling_knickers の front/back 専用テストで別途固定)。
const corpusDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/val-corpus");
const corpus = ["collars", "combinations", "foundation-skirt", "ladies-blouse", "petticoat", "waist"] as const;

describe("valXml projections golden (public-domain .val corpus)", () => {
  for (const name of corpus) {
    it(`pins valXml-backed projections for ${name}.val`, async () => {
      // 守る仕様: 現行 regex の射影出力(increments/details/occurrences/notches/darts)を実 .val ごとに golden 固定する。
      // 実 XML パーサへ差し替えた後にこの snapshot が一致すれば「実データの射影が不変」= 挙動不変の gate。診断 target を
      // 安定させるため filePath は固定値。
      const source = await readFile(join(corpusDir, `${name}.val`), "utf8");
      const filePath = `parts/${name}/source.val`;

      const golden = {
        increments: readIncrementsFromValText(source),
        details: listValDetailsFromText(source),
        occurrences: extractOccurrencesFromValText(source),
        notches: projectNotchesFromValText(source, { filePath }),
        darts: projectDartsFromValText(source, { filePath })
      };

      await expect(`${JSON.stringify(golden, null, 2)}\n`).toMatchFileSnapshot(
        `./__snapshots__/valxml-corpus-${name}.json`
      );
    });
  }
});
