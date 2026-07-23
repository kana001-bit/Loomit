import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { assembleConstraintPayload, collectEdgeOccurrencesFromValText } from "../../src/index.js";

// 実データの ground-truth 回帰。task-spec は「実 outseam で 4 増分すべて usedBy=[back,front]」と主張していたが、原本
// (cycling_knickers.val)はリポ外(c:\Users\kannn\loomitest3)だった。原本を fixture として取り込み、実 front/back piece の
// 射影を repo 内で固定する。合成 fixture では見えない「実 .val の走行」を守る。
//
// この回帰が守るのは「実 front/back **piece** の射影」であって「outseam **固有**の挙動」ではない。理由:
// assembleConstraintPayload は connector 単位で occurrence を絞らない。collectEdgeOccurrences は piece(detail)の**全 passmark**が
// 載るカーブを集め、usedBy は **part 単位 membership**(seam 単位ではない=[C6])。connectorIds は part を seam に参加させるためだけで
// occurrence を絞らない(値を "waist" 等に変えても結果は同じ)。原本 .val を差し替えたら下記の実測値(16/15・4 増分)は見直す。
const valPath = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/cycling-knickers-val/source.val");

function readVal(): Promise<string> {
  return readFile(valPath, "utf8");
}

describe("real cycling_knickers.val (constraint payload ground-truth regression)", () => {
  it("collects the front/back piece's tracked edge occurrences with no diagnostics", async () => {
    // 守る仕様: 実 .val の front/back detail の合印が載るカーブ経由で、piece 単位(全 passmark)で 16 / 15 occurrence を
    // 診断ゼロで集める(手追い [C1] と一致)。古ビルドや XML 走査の退行を実データで捕まえる。
    const source = await readVal();

    const front = collectEdgeOccurrencesFromValText(source, { piece: "front" });
    expect(front.diagnostics).toEqual([]);
    expect(front.occurrences.length).toBe(16);

    const back = collectEdgeOccurrencesFromValText(source, { piece: "back" });
    expect(back.diagnostics).toEqual([]);
    expect(back.occurrences.length).toBe(15);
  });

  it("aggregates part-level usedBy=[back,front] for every increment on the real front/back edges", async () => {
    // 守る仕様: usedBy は **part 単位 membership**(seam 単位ではない・connectorId で絞らない=[C6])。実 front/back の追跡辺に
    // 出る増分は 4 つで、いずれも front/back 両 part に出る = usedBy=[back,front]。合成でなく原本の membership を固定する。
    const source = await readVal();
    const { payload, diagnostics } = assembleConstraintPayload([
      { role: "front", piece: "front", source, connectorIds: ["outseam"] },
      { role: "back", piece: "back", source, connectorIds: ["outseam"] }
    ]);

    expect(diagnostics).toEqual([]);
    // params は「追跡辺が参照した増分」だけ = この 4 つ(他 8 増分は front/back の追跡辺に出ないので載らない)。
    expect(Object.keys(payload.params).sort()).toEqual([
      "#fly_length",
      "#leg_fly_length",
      "#pocket_opening",
      "#pocket_opening_from_waist"
    ]);
    for (const name of Object.keys(payload.params)) {
      expect(payload.params[name]?.usedBy).toEqual(["back", "front"]);
    }
  });
});
