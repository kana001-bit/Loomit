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
