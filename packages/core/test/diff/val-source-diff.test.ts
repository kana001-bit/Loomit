import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { diffValSources } from "../../src/index.js";

const realValPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/cycling-knickers-val/source.val"
);

describe("diffValSources", () => {
  it("reports no change for an identical .val", () => {
    // 守る仕様: 同一本文は same。件数も 0。
    const source = "<pattern><draw name=\"d\"><calculation></calculation></draw></pattern>";

    expect(diffValSources(source, source)).toEqual({ status: "same", changedParameters: 0 });
  });

  it("detects a changed drafting formula in the real .val", async () => {
    // 守る仕様(should-fire): 製図式の変更を1件として数える。これは loomitest4 で実際に起きた編集
    //           (waist band の `waist_circ + 2` → `+ 5` = .val の単位が cm なので +30mm)で、当時 loom diff は
    //           7 パーツ全部 `same` としか言わなかった。
    const before = await readFile(realValPath, "utf8");
    const after = before.replace("waist_circ + 2", "waist_circ + 5");

    expect(after).not.toBe(before);
    expect(diffValSources(before, after)).toMatchObject({ status: "changed", changedParameters: 1 });
  });

  it("detects an increment formula change", () => {
    // 守る仕様: 名前付きツマミ(<increments>)の式変更も製図構造の変化として数える。
    const before = `<pattern>
  <increments>
    <increment description="" formula="10" name="knee_overlap"/>
  </increments>
</pattern>`;
    const after = before.replace('formula="10"', 'formula="12"');

    expect(diffValSources(before, after)).toMatchObject({ status: "changed", changedParameters: 1 });
  });

  it("counts an added and a removed parameter", () => {
    // 守る仕様: 式の変更だけでなく、点の追加・削除も件数に入る(キーは .val の id なので版をまたいで一致する)。
    const before = `<pattern>
  <draw name="d">
    <calculation>
      <point id="1" length="waist_circ" type="endLine"/>
      <point id="2" length="hip_circ" type="endLine"/>
    </calculation>
  </draw>
</pattern>`;
    const after = `<pattern>
  <draw name="d">
    <calculation>
      <point id="1" length="waist_circ" type="endLine"/>
      <point id="3" length="rise_length" type="endLine"/>
    </calculation>
  </draw>
</pattern>`;

    expect(diffValSources(before, after)).toMatchObject({ status: "changed", changedParameters: 2 });
  });

  it("stays silent through Valentina's save-only churn", async () => {
    // 守る仕様(must-not-fire): Valentina は開いて保存し直すだけで大量に churn する(実測では意味のある変更1行に
    //           対し diff 246 行)。raw テキスト比較だと再保存のたびに「製図が変わった」と嘘をつく。
    //           実データに現れた churn を再現する: inUse の切替 / firstToCountour→firstToContour の綴り修正 /
    //           grainline visible→enabled / ラベル位置。
    //           注: 前3つは実 fixture では <modeling> にしか現れず、走査対象は <calculation> なのでそもそも
    //           届かない。denylist が効いているかを実際に確かめているのは mx / showLabel(calculation 内にある)と、
    //           別テストの "ignores label offsets and renames"。
    const before = await readFile(realValPath, "utf8");
    const churned = before
      .replaceAll('inUse="true"', 'inUse="false"')
      .replaceAll("firstToCountour", "firstToContour")
      .replaceAll('visible="true"', 'enabled="true"')
      .replaceAll('mx="0.264583"', 'mx="1.5"')
      .replaceAll('showLabel="true"', 'showLabel="false"');

    expect(churned).not.toBe(before);
    expect(diffValSources(before, churned)).toEqual({ status: "same", changedParameters: 0 });
  });

  it("reports which element changed, with the old and new expression", async () => {
    // 守る仕様: 内訳は「どの要素の・どの属性が・何から何へ」を持つ。実データの編集(loomitest4 の
    //           waist band `waist_circ + 2` → `+ 5`)で、point 119 の length 1件だけが出る。
    const before = await readFile(realValPath, "utf8");
    const after = before.replace("waist_circ + 2", "waist_circ + 5");

    const result = diffValSources(before, after);

    expect(result).toEqual({
      status: "changed",
      changedParameters: 1,
      changes: [
        {
          kind: "modified",
          tag: "point",
          id: "119",
          // Valentina 上の表示名。比較には使わないが、内訳の見出しに使う。
          name: "wb1",
          fields: [{ attribute: "length", before: "waist_circ + 2", after: "waist_circ + 5" }]
        }
      ]
    });
  });

  it("reports added and removed elements without listing every attribute", () => {
    // 守る仕様: 追加・削除は「増えた/消えた」の事実だけを持つ(fields は空)。追加された点の全属性を並べても
    //           読めないため。属性の内訳は modified のときだけ意味がある。
    const before = `<pattern>
  <draw name="d">
    <calculation>
      <point id="1" length="10" name="A" type="endLine"/>
      <point id="2" length="20" name="B" type="endLine"/>
    </calculation>
  </draw>
</pattern>`;
    const after = `<pattern>
  <draw name="d">
    <calculation>
      <point id="1" length="10" name="A" type="endLine"/>
      <point id="3" length="30" name="C" type="endLine"/>
    </calculation>
  </draw>
</pattern>`;

    const result = diffValSources(before, after);

    expect(result.status).toBe("changed");
    expect(result.status === "changed" ? result.changes : []).toEqual([
      { kind: "added", tag: "point", id: "3", name: "C", fields: [] },
      { kind: "removed", tag: "point", id: "2", name: "B", fields: [] }
    ]);
  });

  it("lists an increment change under its own name", () => {
    // 守る仕様: 増分は id を持たない名前付きのツマミ。名前で指せるようにする。
    const before = `<pattern>
  <increments>
    <increment description="" formula="5" name="waistband_height"/>
  </increments>
</pattern>`;

    const result = diffValSources(before, before.replace('formula="5"', 'formula="7"'));

    expect(result.status === "changed" ? result.changes : []).toEqual([
      {
        kind: "modified",
        tag: "increment",
        name: "waistband_height",
        fields: [{ attribute: "formula", before: "5", after: "7" }]
      }
    ]);
  });

  it("lists every attribute that moved on one element", () => {
    // 守る仕様: 1要素で複数の属性が動いたらすべて出す(並びは属性名順で決定的)。
    const before =
      '<pattern><draw name="d"><calculation><point angle="0" id="1" length="10" type="endLine"/></calculation></draw></pattern>';
    const after =
      '<pattern><draw name="d"><calculation><point angle="90" id="1" length="12" type="endLine"/></calculation></draw></pattern>';

    const result = diffValSources(before, after);

    expect(result.status === "changed" ? result.changes[0]?.fields : []).toEqual([
      { attribute: "angle", before: "0", after: "90" },
      { attribute: "length", before: "10", after: "12" }
    ]);
  });

  it("attributes an anonymous element to its XML parent, not to the previous element", () => {
    // 守る仕様(must-not-fire): 所有者は XML 上の**祖先**でなければならない。平坦な走査(直前の id 持ち要素を
    //           所有者とみなす方式)は、閉じタグが見えないので要素を抜けても所有者が親へ戻らない ──
    //           `<calculation>` 末尾の点の後に `<modeling>` が始まると、modeling 側の変更が**その点の変更**
    //           として報告される。ここでは modeling の path の中身だけを変え、calculation の最後の点
    //           (id=2)が名指しされないことを固定する。
    const before = `<pattern>
  <draw name="d">
    <calculation>
      <point id="1" length="10" name="A" type="endLine"/>
      <point id="2" length="20" name="B" type="endLine"/>
    </calculation>
    <modeling>
      <path id="40" name="seam" type="1">
        <nodes>
          <node idObject="1" type="NodePoint"/>
        </nodes>
      </path>
    </modeling>
  </draw>
</pattern>`;
    const after = before.replace('<node idObject="1"', '<node idObject="2"');

    const result = diffValSources(before, after);
    const changes = result.status === "changed" ? result.changes : [];

    // 変更は modeling の path 40 に閉じる。calculation の点は1つも出ない。
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "modified", tag: "path", id: "40" });
    expect(changes.some((change) => change.tag === "point")).toBe(false);
  });

  it("does not report untouched contour nodes as changed when one is inserted", () => {
    // 守る仕様(must-not-fire): id を持たない要素を出現順で対応付けると、先頭に1件挿入しただけで後続のキーが
    //           全部ずれ、**中身が変わっていない node まで modified として名指しする**(1→0 / 2→1 が
    //           modified、末尾に added、で3件)。所有者(detail)に畳むことで、挿入は所有者の変更1件になる。
    const before = `<pattern>
  <draw name="d">
    <details>
      <detail id="106" name="front" width="2">
        <nodes>
          <node idObject="1" type="NodePoint"/>
          <node idObject="2" type="NodePoint"/>
        </nodes>
      </detail>
    </details>
  </draw>
</pattern>`;
    const after = before.replace(
      '<node idObject="1" type="NodePoint"/>',
      '<node idObject="0" type="NodePoint"/>\n          <node idObject="1" type="NodePoint"/>'
    );

    const result = diffValSources(before, after);
    const change = result.status === "changed" ? result.changes[0] : undefined;

    expect(result.status === "changed" ? result.changedParameters : undefined).toBe(1);
    expect(change).toMatchObject({ kind: "modified", tag: "detail", id: "106", name: "front" });
    // 値は比較用のダイジェスト(中身は実装詳細)。「その擬似属性が動いた」ことだけを固定する。
    expect(change?.fields).toHaveLength(1);
    expect(change?.fields[0]?.attribute).toBe("#contents");
    expect(change?.fields[0]?.before).not.toBe(change?.fields[0]?.after);
  });

  it("detects a reordered contour without inventing per-node changes", () => {
    // 守る仕様: 輪郭は順序が意味を持つ(多角形の形が変わる)。並べ替えは所有者の変更として1件で出す。
    const before = `<pattern>
  <draw name="d">
    <details>
      <detail id="106" name="front">
        <nodes>
          <node idObject="1" type="NodePoint"/>
          <node idObject="2" type="NodePoint"/>
        </nodes>
      </detail>
    </details>
  </draw>
</pattern>`;
    const after = before.replace(
      '<node idObject="1" type="NodePoint"/>\n          <node idObject="2" type="NodePoint"/>',
      '<node idObject="2" type="NodePoint"/>\n          <node idObject="1" type="NodePoint"/>'
    );

    const result = diffValSources(before, after);

    expect(result.status === "changed" ? result.changedParameters : undefined).toBe(1);
    expect(result.status === "changed" ? result.changes[0]?.id : undefined).toBe("106");
  });

  it("detects a changed piece contour node", () => {
    // 守る仕様(should-fire): detail の <node idObject> は型紙の輪郭の構成。`diffParts` が比べるのは
    //           darts / notches / connectors / requires だけで**輪郭は誰も比べていない**ので、ここが見ないと
    //           輪郭を差し替えた編集が changes も draftingSource も空のまま素通りする。
    const before = `<pattern>
  <draw name="d">
    <details>
      <detail id="106" name="front" width="2">
        <nodes>
          <node idObject="2" type="NodePoint"/>
          <node idObject="5" type="NodePoint"/>
        </nodes>
      </detail>
    </details>
  </draw>
</pattern>`;

    expect(diffValSources(before, before.replace('idObject="2"', 'idObject="3"'))).toMatchObject({
      status: "changed",
      changedParameters: 1
    });
    // 縫い代幅(detail の width)も幾何。
    expect(diffValSources(before, before.replace('width="2"', 'width="7"'))).toMatchObject({
      status: "changed",
      changedParameters: 1
    });
  });

  it("detects a point moved from one draw to another", () => {
    // 守る仕様(should-fire): キーから draw を落とすと、同じ点を別の draw へ移した編集が「同じキー・同じ値」に
    //           なり same になる。draw 名ではなく **draw の位置** をキーに含めることで、改名に強いまま所属を保つ。
    const before = `<pattern>
  <draw name="a"><calculation><point id="7" length="10" type="endLine"/></calculation></draw>
  <draw name="b"><calculation></calculation></draw>
</pattern>`;
    const after = `<pattern>
  <draw name="a"><calculation></calculation></draw>
  <draw name="b"><calculation><point id="7" length="10" type="endLine"/></calculation></draw>
</pattern>`;

    // draw0 から消えて draw1 に生えた = 2 件。
    expect(diffValSources(before, after)).toMatchObject({ status: "changed", changedParameters: 2 });
  });

  it("ignores a renamed draw", async () => {
    // 守る仕様(must-not-fire): draw の改名は幾何を動かさない。キーに draw 名を含めていたときは、実 fixture で
    //           1 文字の改名が changed (206 parameters) になっていた ── このモジュールが name を無視すると
    //           決めているのに draw の name だけ load-bearing、というねじれ。要素 id は .val 全体で一意なので、
    //           曖昧性解消に draw 名は要らない。
    const before = await readFile(realValPath, "utf8");
    const renamed = before.replace('<draw name="knickers">', '<draw name="Knickers">');

    expect(renamed).not.toBe(before);
    expect(diffValSources(before, renamed)).toEqual({ status: "same", changedParameters: 0 });
  });

  it("still separates same-named elements that carry no id", () => {
    // 守る仕様: id を持たない要素(<item> など)は出現順で識別する。draw 名を落としても、draw の**位置**で
    //           分けているので別 draw の無名要素が同じキーに畳まれない。
    const before = `<pattern>
  <draw name="a"><calculation><operation id="9" type="moving"><source><item idObject="1"/></source></operation></calculation></draw>
  <draw name="b"><calculation><operation id="10" type="moving"><source><item idObject="2"/></source></operation></calculation></draw>
</pattern>`;
    const after = before.replace('<item idObject="2"/>', '<item idObject="3"/>');

    expect(diffValSources(before, after)).toMatchObject({ status: "changed", changedParameters: 1 });
  });

  it("detects a changed point angle", async () => {
    // 守る仕様(should-fire): 点の `angle` は「辺の仕上がり長に効く出現」ではないので拘束 payload の抽出器は
    //           意図的に外している([O-occurrence網羅])。しかし角度を変えれば幾何は動く。長さ寄与だけを見る
    //           抽出器を流用すると、この編集を取りこぼして `same` と言ってしまう。
    const before = await readFile(realValPath, "utf8");
    const after = before.replace('angle="270"', 'angle="271"');

    expect(after).not.toBe(before);
    expect(diffValSources(before, after)).toMatchObject({ status: "changed", changedParameters: 1 });
  });

  it("detects a changed arc radius", () => {
    // 守る仕様(should-fire): `<arc>` も拘束 payload の抽出器の対象外だが、半径を変えれば製図は動く。
    const before = `<pattern>
  <draw name="d">
    <calculation>
      <arc angle1="320" angle2="350" center="66" id="74" radius="waist_circ / 2 + 10"/>
    </calculation>
  </draw>
</pattern>`;
    const after = before.replace("waist_circ / 2 + 10", "waist_circ / 2 + 12");

    expect(diffValSources(before, after)).toMatchObject({ status: "changed", changedParameters: 1 });
  });

  it("detects a changed point type and a moved single point", () => {
    // 守る仕様(should-fire): 点の型(endLine → alongLine)や、`type="single"` の x/y も幾何。属性を列挙して
    //           拾う方式(whitelist)だと、こういう「式ではない幾何」を取りこぼす。
    const before = `<pattern>
  <draw name="d">
    <calculation>
      <point id="1" type="single" x="0.79" y="1.05"/>
      <point id="2" basePoint="1" length="10" type="endLine"/>
    </calculation>
  </draw>
</pattern>`;

    expect(diffValSources(before, before.replace('x="0.79"', 'x="2.50"'))).toMatchObject({
      status: "changed",
      changedParameters: 1
    });
    expect(diffValSources(before, before.replace('type="endLine"', 'type="alongLine"'))).toMatchObject({
      status: "changed",
      changedParameters: 1
    });
  });

  it("detects a changed unit", () => {
    // 守る仕様(should-fire): 単位が変われば全寸法の意味が変わる。`<unit>` は draw の外なので個別に見る。
    const before = "<pattern><unit>cm</unit><draw name=\"d\"><calculation></calculation></draw></pattern>";

    expect(diffValSources(before, before.replace("cm", "mm"))).toMatchObject({
      status: "changed",
      changedParameters: 1
    });
  });

  it("ignores label offsets and renames", () => {
    // 守る仕様(must-not-fire): ラベルをドラッグしただけ(mx/my)や点の改名は幾何を動かさない。式が名前を参照して
    //           いれば、その式側の変化として捕まる。
    const before = `<pattern>
  <draw name="d">
    <calculation>
      <point id="1" length="10" mx="0.26" my="0.39" name="A" showLabel="true" type="endLine"/>
    </calculation>
  </draw>
</pattern>`;
    const after = before
      .replace('mx="0.26"', 'mx="4.10"')
      .replace('my="0.39"', 'my="-2.00"')
      .replace('name="A"', 'name="A1"');

    expect(diffValSources(before, after)).toEqual({ status: "same", changedParameters: 0 });
  });

  it("does not treat a reformatted expression as equal", () => {
    // 守る仕様: 式は評価せず文字列として比べる(A案: Loomit は式を解釈しない)。空白違いを「同値」と判定できる
    //           ふりをせず、動いたとして報告する。過検出は測定を促すだけで、黙るより安全。
    const before = '<pattern><draw name="d"><calculation><point id="1" length="a + 2" type="endLine"/></calculation></draw></pattern>';
    const after = before.replace("a + 2", "a+2");

    expect(diffValSources(before, after)).toMatchObject({ status: "changed", changedParameters: 1 });
  });
});
