import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { projectNotchesFromValFile, projectNotchesFromValText } from "../../src/index.js";

describe("projectNotchesFromValText", () => {
  it("projects passmark nodes on a seam path into notches", () => {
    // 守る仕様: 縫い線 path(name="seam")上で passmark="1" の node を、seam＋位置＋種別の合印へ射影する。
    //           passmark でない node は無視し、種別が無ければ type を省く。
    const result = projectNotchesFromValText(
      `<?xml version="1.0" encoding="UTF-8"?>
<pattern>
  <draw name="bodice">
    <modeling>
      <path id="40" inUse="true" name="seam" seam="side" type="1">
        <nodes>
          <node idObject="50" type="NodePoint"/>
          <node idObject="51" type="NodePoint" passmark="1" passmarkType="single" position="0.25"/>
          <node idObject="52" type="NodePoint" passmark="1" position="0.75"/>
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
    expect(result.notches).toEqual({
      "val:bodice:notch:side:51": {
        seam_ref: "val:seam#bodice/side",
        position: 0.25,
        type: "single"
      },
      "val:bodice:notch:side:52": {
        seam_ref: "val:seam#bodice/side",
        position: 0.75
      }
    });
  });

  it("skips a passmark without a valid seam position and reports a diagnostic", () => {
    // 守る仕様(案E相当): 位置(0..1)を持たない passmark は幾何を発明せずスキップし、warning を出す。
    const result = projectNotchesFromValText(
      `<?xml version="1.0" encoding="UTF-8"?>
<pattern>
  <draw name="bodice">
    <modeling>
      <path id="41" inUse="true" name="seam" seam="hem" type="1">
        <nodes>
          <node idObject="60" type="NodePoint" passmark="1"/>
        </nodes>
      </path>
    </modeling>
  </draw>
</pattern>`,
      {
        filePath: "fixture.val"
      }
    );

    expect(result.notches).toEqual({});
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("PART_SOURCE_VAL_NOTCH_UNSUPPORTED");
    expect(result.diagnostics[0]?.target).toBe("fixture.val#bodice/hem/60");
  });

  it("ignores paths that are not seams", () => {
    // 守る仕様: dart など seam 以外の path 上の node は合印射影の対象にしない。
    const result = projectNotchesFromValText(
      `<?xml version="1.0" encoding="UTF-8"?>
<pattern>
  <draw name="bodice">
    <modeling>
      <path id="42" inUse="true" name="dart" type="2">
        <nodes>
          <node idObject="70" type="NodePoint" passmark="1" position="0.5"/>
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
    expect(result.notches).toEqual({});
  });

  it("projects notches across multiple draws and seams with stable ids", () => {
    // 守る仕様: id は draw 名・seam 名・node を含むので、複数の draw/seam に散った合印も衝突せず区別できる。
    //          passmark フラグが立っていない node は無視し、境界の 0 と 1 は縫い線の両端として受け付ける。
    const result = projectNotchesFromValText(
      `<?xml version="1.0" encoding="UTF-8"?>
<pattern>
  <draw name="front">
    <modeling>
      <path id="40" inUse="true" name="seam" seam="side" type="1">
        <nodes>
          <node idObject="50" type="NodePoint" passmark="1" position="0"/>
          <node idObject="51" type="NodePoint" passmark="0" position="0.5"/>
          <node idObject="52" type="NodePoint" passmark="1" position="1"/>
        </nodes>
      </path>
    </modeling>
  </draw>
  <draw name="back">
    <modeling>
      <path id="41" inUse="true" name="seam" seam="side" type="1">
        <nodes>
          <node idObject="60" type="NodePoint" passmark="1" position="0.5"/>
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
    expect(result.notches).toEqual({
      "val:front:notch:side:50": { seam_ref: "val:seam#front/side", position: 0 },
      "val:front:notch:side:52": { seam_ref: "val:seam#front/side", position: 1 },
      "val:back:notch:side:60": { seam_ref: "val:seam#back/side", position: 0.5 }
    });
  });

  it("skips a passmark whose position is outside the 0..1 seam range", () => {
    // 守る仕様: 縫い線の外(0..1 外)を指す passmark は不正なので射影せず warning を出す。
    const result = projectNotchesFromValText(
      `<?xml version="1.0" encoding="UTF-8"?>
<pattern>
  <draw name="bodice">
    <modeling>
      <path id="43" inUse="true" name="seam" seam="side" type="1">
        <nodes>
          <node idObject="80" type="NodePoint" passmark="1" position="1.5"/>
        </nodes>
      </path>
    </modeling>
  </draw>
</pattern>`,
      {
        filePath: "fixture.val"
      }
    );

    expect(result.notches).toEqual({});
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("PART_SOURCE_VAL_NOTCH_UNSUPPORTED");
  });

  it("skips a passmark whose position attribute is empty and reports a diagnostic", () => {
    // 守る仕様: position="" は Number("") が 0 に化けるが、位置なしとして弾く(縫い線始点 0 の合印と取り違えない)。
    const result = projectNotchesFromValText(
      `<?xml version="1.0" encoding="UTF-8"?>
<pattern>
  <draw name="bodice">
    <modeling>
      <path id="44" inUse="true" name="seam" seam="side" type="1">
        <nodes>
          <node idObject="90" type="NodePoint" passmark="1" position=""/>
        </nodes>
      </path>
    </modeling>
  </draw>
</pattern>`,
      {
        filePath: "fixture.val"
      }
    );

    expect(result.notches).toEqual({});
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("PART_SOURCE_VAL_NOTCH_UNSUPPORTED");
  });

  it("omits type when passmarkType is present but empty", () => {
    // 守る仕様: passmarkType="" は schema(min 1)に反するので、空の種別を作らず type を省く。
    const result = projectNotchesFromValText(
      `<?xml version="1.0" encoding="UTF-8"?>
<pattern>
  <draw name="bodice">
    <modeling>
      <path id="45" inUse="true" name="seam" seam="side" type="1">
        <nodes>
          <node idObject="91" type="NodePoint" passmark="1" passmarkType="" position="0.5"/>
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
    expect(result.notches).toEqual({
      "val:bodice:notch:side:91": {
        seam_ref: "val:seam#bodice/side",
        position: 0.5
      }
    });
  });

  it("projects Seamly2D notchLength/notchWidth into depth_mm/width_mm", () => {
    // 守る仕様: Seamly2D は合印の寸法を node に数値で持つ(notchLength=縫い代方向の深さ, notchWidth=マーク幅)。
    //           これを depth_mm / width_mm へ read-only 射影する。
    const result = projectNotchesFromValText(
      `<?xml version="1.0" encoding="UTF-8"?>
<pattern>
  <draw name="bodice">
    <modeling>
      <path id="46" inUse="true" name="seam" seam="side" type="1">
        <nodes>
          <node idObject="92" type="NodePoint" passmark="1" position="0.5" notchLength="8" notchWidth="3"/>
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
    expect(result.notches).toEqual({
      "val:bodice:notch:side:92": {
        seam_ref: "val:seam#bodice/side",
        position: 0.5,
        depth_mm: 8,
        width_mm: 3
      }
    });
  });

  it("projects real Valentina detail passmarks into identity-only notches (piece + type + angle, no position)", () => {
    // 守る仕様(方言2): 実 Valentina は合印を <details>/<detail name>/<nodes> の passmark="true" node に持つ。
    //           position を持たない(位置は仕上がり線の弧長=幾何で下流が解決)ため、piece(detail名=DXF BLOCK名)＋
    //           種別(passmarkLine=V/T)＋向き(passmarkAngle)だけの identity-only notch へ射影し、warning は出さない。
    const result = projectNotchesFromValText(
      `<?xml version="1.0" encoding="UTF-8"?>
<pattern>
  <unit>cm</unit>
  <draw name="knickers">
    <calculation/>
    <modeling>
      <point id="126" idObject="65" inUse="true" type="modeling"/>
    </modeling>
    <details>
      <detail id="62" name="front" seamAllowance="true" version="2" width="2">
        <data/>
        <nodes>
          <node idObject="65" type="NodePoint"/>
          <node idObject="169" passmark="true" passmarkAngle="straightforward" passmarkLine="vMark" type="NodePoint"/>
          <node idObject="141" passmark="true" passmarkAngle="straightforward" passmarkLine="tMark" type="NodePoint"/>
        </nodes>
      </detail>
      <detail id="111" name="back" seamAllowance="true" version="2" width="2">
        <nodes>
          <node idObject="173" passmark="true" passmarkAngle="straightforward" passmarkLine="vMark" type="NodePoint"/>
        </nodes>
      </detail>
    </details>
  </draw>
</pattern>`,
      {
        filePath: "fixture.val"
      }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.notches).toEqual({
      "val:front:notch:169": { piece: "front", order: 0, type: "vMark", angle: "straightforward" },
      "val:front:notch:141": { piece: "front", order: 1, type: "tMark", angle: "straightforward" },
      "val:back:notch:173": { piece: "back", order: 0, type: "vMark", angle: "straightforward" }
    });
  });

  it("projects detail passmarks across multiple draws", () => {
    // 守る仕様: .val は複数の <draw> を持ちうる(本体+裏地など)。各 draw の <details> を走査し、最初の draw
    //           以外の合印を落とさない(collectFirstBlock で最初の <details> だけを見るリグレッションの防止)。
    const result = projectNotchesFromValText(
      `<?xml version="1.0" encoding="UTF-8"?>
<pattern>
  <draw name="knickers">
    <details>
      <detail id="62" name="front">
        <nodes>
          <node idObject="169" passmark="true" passmarkLine="vMark" type="NodePoint"/>
        </nodes>
      </detail>
    </details>
  </draw>
  <draw name="lining">
    <details>
      <detail id="70" name="pocket">
        <nodes>
          <node idObject="200" passmark="true" passmarkLine="tMark" type="NodePoint"/>
        </nodes>
      </detail>
    </details>
  </draw>
</pattern>`,
      {
        filePath: "fixture.val"
      }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.notches).toEqual({
      "val:front:notch:169": { piece: "front", order: 0, type: "vMark" },
      "val:pocket:notch:200": { piece: "pocket", order: 0, type: "tMark" }
    });
  });

  it("warns and keeps the first detail when a piece name repeats across draws", () => {
    // 守る仕様(契約): piece(detail)名は DXF BLOCK の identity なので .val 全体で一意でなければならない。
    //           複数 draw に同名 detail があると notch キー(val:<piece>:notch:<node>)が衝突するため、黙って
    //           上書きせず最初の detail を採用し、以降の同名 detail は warning を出して捨てる(silent data loss を防ぐ)。
    const result = projectNotchesFromValText(
      `<?xml version="1.0" encoding="UTF-8"?>
<pattern>
  <draw name="main">
    <details>
      <detail id="1" name="front">
        <nodes>
          <node idObject="10" passmark="true" passmarkLine="vMark" type="NodePoint"/>
        </nodes>
      </detail>
    </details>
  </draw>
  <draw name="lining">
    <details>
      <detail id="2" name="front">
        <nodes>
          <node idObject="10" passmark="true" passmarkLine="tMark" type="NodePoint"/>
        </nodes>
      </detail>
    </details>
  </draw>
</pattern>`,
      {
        filePath: "fixture.val"
      }
    );

    expect(result.notches).toEqual({
      "val:front:notch:10": { piece: "front", order: 0, type: "vMark" }
    });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("PART_SOURCE_VAL_NOTCH_DUPLICATE_PIECE");
    expect(result.diagnostics[0]?.target).toBe("fixture.val#front");
  });

  it("assigns distinct order to multiple same-type passmarks in one piece", () => {
    // 守る仕様: 同一 piece に同種(vMark)の合印が複数あるとき、DXF の seam 順(layer4=V の POINT 列)と 1:1 対応
    //           づけるための order を contour(node)順で 0,1,2... と割り振り、順序情報を境界に残す。
    const result = projectNotchesFromValText(
      `<?xml version="1.0" encoding="UTF-8"?>
<pattern>
  <draw name="knickers">
    <details>
      <detail id="62" name="front">
        <nodes>
          <node idObject="169" passmark="true" passmarkLine="vMark" type="NodePoint"/>
          <node idObject="65" type="NodePoint"/>
          <node idObject="170" passmark="true" passmarkLine="vMark" type="NodePoint"/>
          <node idObject="171" passmark="true" passmarkLine="vMark" type="NodePoint"/>
        </nodes>
      </detail>
    </details>
  </draw>
</pattern>`,
      {
        filePath: "fixture.val"
      }
    );

    expect(result.diagnostics).toEqual([]);
    // 非 passmark node(65)は order に数えない。passmark だけが 0,1,2 と並ぶ。
    expect(result.notches).toEqual({
      "val:front:notch:169": { piece: "front", order: 0, type: "vMark" },
      "val:front:notch:170": { piece: "front", order: 1, type: "vMark" },
      "val:front:notch:171": { piece: "front", order: 2, type: "vMark" }
    });
  });

  it("ignores non-passmark detail nodes and unnamed details", () => {
    // 守る仕様: detail の contour node のうち passmark="true" のものだけを合印にする。passmark 無し node は無視し、
    //           detail 名(identity=DXF BLOCK名)が無い detail は突き合わせに使えないため丸ごと対象外。
    const result = projectNotchesFromValText(
      `<?xml version="1.0" encoding="UTF-8"?>
<pattern>
  <draw name="knickers">
    <details>
      <detail id="62" name="front">
        <nodes>
          <node idObject="65" type="NodePoint"/>
          <node idObject="169" passmark="true" passmarkLine="vMark" type="NodePoint"/>
        </nodes>
      </detail>
      <detail id="99">
        <nodes>
          <node idObject="200" passmark="true" passmarkLine="vMark" type="NodePoint"/>
        </nodes>
      </detail>
    </details>
  </draw>
</pattern>`,
      {
        filePath: "fixture.val"
      }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.notches).toEqual({
      "val:front:notch:169": { piece: "front", order: 0, type: "vMark" }
    });
  });

  it("keys a detail passmark by node order when idObject is absent", () => {
    // 守る仕様: idObject が無い場合のみ detail 内の node 並び順を fallback キーにする(実 Valentina では常に付くが防御的に)。
    const result = projectNotchesFromValText(
      `<?xml version="1.0" encoding="UTF-8"?>
<pattern>
  <draw name="knickers">
    <details>
      <detail id="62" name="front">
        <nodes>
          <node type="NodePoint"/>
          <node passmark="true" passmarkLine="tMark" type="NodePoint"/>
        </nodes>
      </detail>
    </details>
  </draw>
</pattern>`,
      {
        filePath: "fixture.val"
      }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.notches).toEqual({
      "val:front:notch:node1": { piece: "front", order: 0, type: "tMark" }
    });
  });

  it("omits notch depth_mm/width_mm when the dimensions are absent or non-positive", () => {
    // 守る仕様: 寸法未設定・0・負は「指定なし」として黙って省く(Seamly2D は既定値運用があり、書かれていないのは正常系)。
    //           位置さえ読めれば合印自体は射影する。
    const result = projectNotchesFromValText(
      `<?xml version="1.0" encoding="UTF-8"?>
<pattern>
  <draw name="bodice">
    <modeling>
      <path id="47" inUse="true" name="seam" seam="side" type="1">
        <nodes>
          <node idObject="93" type="NodePoint" passmark="1" position="0.5" notchLength="0" notchWidth="-1"/>
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
    expect(result.notches).toEqual({
      "val:bodice:notch:side:93": {
        seam_ref: "val:seam#bodice/side",
        position: 0.5
      }
    });
  });
});

describe("projectNotchesFromValFile", () => {
  it("is silent when the source.val file is absent", async () => {
    // 守る仕様(案E): source.val が無いのは正常系。合印射影は空で、警告も出さない。
    const missingPath = join(
      fileURLToPath(new URL("../fixtures/load-files/valid-part/", import.meta.url)),
      "does-not-exist.val"
    );

    const result = await projectNotchesFromValFile(missingPath);

    expect(result.notches).toEqual({});
    expect(result.diagnostics).toEqual([]);
  });
});
