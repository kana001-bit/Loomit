import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadProjectedPart, partSchema } from "../../src/index.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/load-files");

// 実 Valentina 方言の最小 .val。idObject を変えると射影される notch のキーが変わるので、
// 「どちらのファイルが読まれたか」を射影結果から判別できる。
function valWithPassmark(idObject: string): string {
  return [
    "<pattern>",
    '<draw name="d">',
    "<details>",
    '<detail name="body">',
    "<nodes>",
    `<node idObject="${idObject}" passmark="true" passmarkLine="vMark" type="NodePoint"/>`,
    "</nodes>",
    "</detail>",
    "</details>",
    "</draw>",
    "</pattern>",
    ""
  ].join("\n");
}

// parts/body/part.loom を持つ一時ディレクトリ。withProjectFile=false なら loomit.yml を置かない
// (project に属さない orphan part.loom = loom diff のパス指定モードの状況)。
async function makeTempPart(withProjectFile: boolean): Promise<{
  readonly root: string;
  readonly partFilePath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "loomit-projected-"));
  await mkdir(join(root, "parts/body"), { recursive: true });

  if (withProjectFile) {
    await writeFile(
      join(root, "loomit.yml"),
      [
        "schema: loomit.project.v0",
        "name: projected",
        "garment: blouse",
        "parts:",
        "  body: ./parts/body/part.loom"
      ].join("\n"),
      "utf8"
    );
  }

  await writeFile(
    join(root, "parts/body/part.loom"),
    [
      "schema: loomit.part.v0",
      "name: body",
      "variant: v1",
      "type: body",
      "files:",
      "  source: body.val"
    ].join("\n"),
    "utf8"
  );

  return { root, partFilePath: join(root, "parts/body/part.loom") };
}

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

  it("projects notches from source.val when part.loom omits them", async () => {
    // 守る仕様: notches を持たず files.source がある part は、source.val の seam passmark から read-only に射影する。
    const result = await loadProjectedPart(
      join(fixturesRoot, "valid-part-projected-notches/part.loom")
    );

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.notches : {}).toEqual({
      "val:block:notch:armhole:21": {
        seam_ref: "val:seam#block/armhole",
        position: 0.5,
        type: "single",
        depth_mm: 8,
        width_mm: 3
      }
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("projects native Valentina detail passmarks as identity-only notches", async () => {
    // 守る仕様(方言2): files.source が実 Valentina の .val のとき、<details>/<detail>/<nodes> の passmark="true"
    //           node を piece(detail名=DXF BLOCK名)＋種別(vMark/tMark)＋向きの identity-only notch へ射影する。
    //           position/seam_ref は持たない(位置は仕上がり線の幾何で下流=Seamlint が解決)。
    const result = await loadProjectedPart(
      join(fixturesRoot, "valid-part-projected-notches-valentina/part.loom")
    );

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.notches : {}).toEqual({
      "val:front:notch:169": { piece: "front", order: 0, type: "vMark", angle: "straightforward" },
      "val:front:notch:141": { piece: "front", order: 1, type: "tMark", angle: "straightforward" }
    });
    expect(result.diagnostics).toEqual([]);

    // 射影した identity-only notch が正本 schema を満たすことも固定する(A案の緩和が実方言で成立する保証)。
    expect(() => partSchema.parse(result.ok ? result.value : undefined)).not.toThrow();
  });

  it("keeps inline darts without projecting darts from source.val", async () => {
    // 守る仕様: part.loom が darts を明示していれば dart 射影はせずそのまま使う。
    // (source.val=front.val は存在しないため notch 射影も silent に空で、diagnostics は出ない。)
    const result = await loadProjectedPart(join(fixturesRoot, "valid-part-with-darts/part.loom"));

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.darts?.waist_front?.width_mm : 0).toBe(30);
    expect(result.diagnostics).toEqual([]);
  });

  it("is silent when the referenced source.val is absent", async () => {
    // 守る仕様(案E): source.val が存在しないのは正常系。射影は空で、警告も出さない。
    const result = await loadProjectedPart(join(fixturesRoot, "valid-part/part.loom"));

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.darts : {}).toBeUndefined();
    expect(result.diagnostics).toEqual([]);
  });

  it("climbs to the project root and projects from the root original, not the part copy", async () => {
    // 守る仕様: 呼び手が projectRoot を渡さなくても、part.loom から loomit.yml を探して登り、project root
    // 側の原本から射影する。これが `loom diff <a.loom> <b.loom>`(project を読まない経路)で「古い part
    // コピーから射影して黙って嘘の差分を出す」のを防ぐ要。
    const { root, partFilePath } = await makeTempPart(true);

    try {
      // root = 原本(idObject 1) / part コピー = 古い別内容(idObject 2)。どちらが読まれたかがキーで分かる。
      await writeFile(join(root, "body.val"), valWithPassmark("1"), "utf8");
      await writeFile(join(root, "parts/body/body.val"), valWithPassmark("2"), "utf8");

      const result = await loadProjectedPart(partFilePath);

      expect(result.ok).toBe(true);
      expect(Object.keys(result.ok ? (result.value.notches ?? {}) : {})).toEqual([
        "val:body:notch:1"
      ]);
      expect(result.diagnostics).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to the part copy for an orphan part.loom with no project above it", async () => {
    // 守る仕様: loomit.yml が見つからない part.loom は正当な入力(loom diff のパス指定モード)なので、
    // 診断を出さず part 相対で射影する。登れなかったことをエラーにしない。
    const { root, partFilePath } = await makeTempPart(false);

    try {
      // loomit.yml が無いので root 側は候補にならない。読まれるのは part コピー(idObject 2)。
      await writeFile(join(root, "body.val"), valWithPassmark("1"), "utf8");
      await writeFile(join(root, "parts/body/body.val"), valWithPassmark("2"), "utf8");

      const result = await loadProjectedPart(partFilePath);

      expect(result.ok).toBe(true);
      expect(Object.keys(result.ok ? (result.value.notches ?? {}) : {})).toEqual([
        "val:body:notch:2"
      ]);
      expect(result.diagnostics).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses a caller-supplied projectRoot without climbing for loomit.yml", async () => {
    // 守る仕様: project を既に読んでいる呼び手は projectRoot を渡せて、その値がそのまま使われる
    // (loomit.yml の探索結果に依存しない)。ここでは loomit.yml を置かないので、登り任せなら part
    // コピーが読まれるはず。root が読まれることで「渡した値が効いている」ことを固定する。
    const { root, partFilePath } = await makeTempPart(false);

    try {
      await writeFile(join(root, "body.val"), valWithPassmark("1"), "utf8");
      await writeFile(join(root, "parts/body/body.val"), valWithPassmark("2"), "utf8");

      const result = await loadProjectedPart(partFilePath, { projectRoot: root });

      expect(result.ok).toBe(true);
      expect(Object.keys(result.ok ? (result.value.notches ?? {}) : {})).toEqual([
        "val:body:notch:1"
      ]);
      expect(result.diagnostics).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// 実 .val は「1着 = 1 draw ＋ N detail」で、複数 part が同じ .val を共有する(loomitest3 は全 part が
// cycling_knickers.val)。射影を part 単位に帰属させないと、front の合印/ダーツ変更が back の diff にも出る。
const garmentVal = [
  "<pattern>",
  '<draw name="d">',
  "<calculation>",
  '<point id="1" name="Apex" type="alongLine" length="CurrentLength/2"/>',
  '<point id="2" name="LegLeft" type="alongLine" length="#dart / 2"/>',
  '<point id="3" name="LegRight" type="alongLine" length="Line_A_B"/>',
  "</calculation>",
  "<modeling>",
  '<point id="11" idObject="2" type="modeling"/>',
  '<point id="12" idObject="1" type="modeling"/>',
  '<point id="13" idObject="3" type="modeling"/>',
  '<path id="20" name="dart" type="2">',
  "<nodes>",
  '<node idObject="11" type="NodePoint"/>',
  '<node idObject="12" type="NodePoint"/>',
  '<node idObject="13" type="NodePoint"/>',
  "</nodes>",
  "</path>",
  "</modeling>",
  "<details>",
  '<detail name="front">',
  "<nodes>",
  '<node idObject="70" passmark="true" passmarkLine="vMark" type="NodePoint"/>',
  "</nodes>",
  "<iPaths>",
  '<record path="20"/>',
  "</iPaths>",
  "</detail>",
  '<detail name="back">',
  "<nodes>",
  '<node idObject="80" passmark="true" passmarkLine="tMark" type="NodePoint"/>',
  "</nodes>",
  "</detail>",
  "</details>",
  "</draw>",
  "</pattern>",
  ""
].join("\n");

// 1つの .val を front / back の2 part が共有する project。piece を宣言するかは part ごとに選べる。
async function makeGarmentProject(pieces: {
  readonly front?: string;
  readonly back?: string;
}): Promise<{ readonly root: string }> {
  const root = await mkdtemp(join(tmpdir(), "loomit-piece-scope-"));

  await writeFile(
    join(root, "loomit.yml"),
    [
      "schema: loomit.project.v0",
      "name: garment",
      "garment: knickers",
      "parts:",
      "  front: ./parts/front/part.loom",
      "  back: ./parts/back/part.loom"
    ].join("\n"),
    "utf8"
  );
  await writeFile(join(root, "garment.val"), garmentVal, "utf8");

  for (const role of ["front", "back"] as const) {
    const piece = pieces[role];
    await mkdir(join(root, "parts", role), { recursive: true });
    await writeFile(
      join(root, "parts", role, "part.loom"),
      [
        "schema: loomit.part.v0",
        `name: ${role}`,
        "variant: v1",
        "type: body",
        "files:",
        "  source: garment.val",
        ...(piece === undefined ? [] : [`  piece: ${piece}`])
      ].join("\n"),
      "utf8"
    );
  }

  return { root };
}

describe("loadProjectedPart (piece scope)", () => {
  it("projects only the features that belong to the part's piece", async () => {
    // 守る仕様: files.piece を宣言した part は、自分の detail の合印と、自分が <iPaths> で名指しするダーツだけを
    //           受け取る。1つの .val を複数 part が共有していても混ざらない。
    const { root } = await makeGarmentProject({ front: "front", back: "back" });

    try {
      const result = await loadProjectedPart(join(root, "parts/front/part.loom"));

      expect(result.ok).toBe(true);
      expect(Object.keys(result.ok ? (result.value.notches ?? {}) : {})).toEqual([
        "val:front:notch:70"
      ]);
      expect(Object.keys(result.ok ? (result.value.darts ?? {}) : {})).toEqual(["val:d:dart:20"]);
      expect(result.diagnostics).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not give a part the other piece's notches or darts", async () => {
    // 守る仕様(must-not-fire): back は自分の合印だけを受け取り、front の合印と、front の <iPaths> にしか
    //           載っていないダーツを受け取らない。これを外すと front だけを直したのに back の diff が動く。
    const { root } = await makeGarmentProject({ front: "front", back: "back" });

    try {
      const result = await loadProjectedPart(join(root, "parts/back/part.loom"));

      expect(result.ok).toBe(true);
      expect(Object.keys(result.ok ? (result.value.notches ?? {}) : {})).toEqual([
        "val:back:notch:80"
      ]);
      expect(result.ok ? result.value.darts : undefined).toBeUndefined();
      expect(result.diagnostics).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("warns instead of scoping when files.piece is missing on a multi-piece .val", async () => {
    // 守る仕様: 絞る鍵(files.piece)が無い part は、従来どおり全ピース分を受け取ったうえで warning を出す。
    //           射影を捨てて「フィーチャ無し」と嘘をつかず、混ざっていることを黙らせもしない。
    const { root } = await makeGarmentProject({ back: "back" });

    try {
      const result = await loadProjectedPart(join(root, "parts/front/part.loom"));

      expect(result.ok).toBe(true);
      expect(Object.keys(result.ok ? (result.value.notches ?? {}) : {}).sort()).toEqual([
        "val:back:notch:80",
        "val:front:notch:70"
      ]);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        "PART_SOURCE_VAL_PIECE_UNDECLARED"
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports the declared piece being absent from the .val instead of projecting nothing", async () => {
    // 守る仕様: 宣言した files.piece が .val に無いとき、絞り込みの結果(一致0件)を「フィーチャの無いピース」と
    //           見分けられないまま黙らない。綴り違いや Valentina 側の detail リネームで diff からダーツ・合印が
    //           丸ごと消えるのを、explainable な warning で surface する。target は piece 名(この code の既存の
    //           出どころ collectEdgeOccurrencesFromVal と同じ形式。同じ code で形が割れると消費側が壊れる)。
    const { root } = await makeGarmentProject({ front: "frnt", back: "back" });

    try {
      const result = await loadProjectedPart(join(root, "parts/front/part.loom"));

      expect(result.ok).toBe(true);
      expect(result.ok ? result.value.notches : undefined).toBeUndefined();
      expect(result.ok ? result.value.darts : undefined).toBeUndefined();
      expect(
        result.diagnostics.map((diagnostic) => ({
          code: diagnostic.code,
          target: diagnostic.target
        }))
      ).toEqual([{ code: "PART_SOURCE_VAL_PIECE_NOT_FOUND", target: "frnt" }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not fall back to an unscoped projection when the declared piece is absent", async () => {
    // 守る仕様(must-not-fire): piece が見つからないときに「絞れないので全ピース」へ落とさない。落とすと他ピースの
    //           合印が混ざった差分を正しい差分として見せることになり、このブランチが直したバグに戻る。
    const { root } = await makeGarmentProject({ front: "frnt", back: "back" });

    try {
      const result = await loadProjectedPart(join(root, "parts/front/part.loom"));

      expect(Object.keys(result.ok ? (result.value.notches ?? {}) : {})).toEqual([]);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
        "PART_SOURCE_VAL_PIECE_UNDECLARED"
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("projects a .val that declares no pieces without scoping or warning", async () => {
    // 守る仕様(must-not-fire): piece を1つも宣言しない .val(<details> を持たない Seamly2D 方言)では帰属という
    //           概念が無い。files.piece は DXF BLOCK 名として正当な宣言なので、絞らずに射影し警告も出さない。
    //           絞ると「seam path の合印は残るのにダーツだけ黙って消える」半端な結果になり、射影は成功して
    //           いるのに PART_SOURCE_VAL_PIECE_NOT_FOUND まで出る。
    const root = await mkdtemp(join(tmpdir(), "loomit-piece-dialect1-"));

    try {
      await mkdir(join(root, "parts/body"), { recursive: true });
      await writeFile(
        join(root, "loomit.yml"),
        [
          "schema: loomit.project.v0",
          "name: seamly",
          "garment: blouse",
          "parts:",
          "  body: ./parts/body/part.loom"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(root, "parts/body/part.loom"),
        [
          "schema: loomit.part.v0",
          "name: body",
          "variant: v1",
          "type: body",
          "files:",
          "  source: body.val",
          "  piece: BODY"
        ].join("\n"),
        "utf8"
      );
      // 方言1: 合印は <modeling>/<path name="seam"> に載り、<details> は無い。ダーツも同じ modeling にある。
      await writeFile(
        join(root, "body.val"),
        [
          "<pattern>",
          '<draw name="block">',
          "<calculation>",
          '<point id="1" name="Apex" type="alongLine" length="CurrentLength/2"/>',
          '<point id="2" name="LegLeft" type="alongLine" length="#dart / 2"/>',
          '<point id="3" name="LegRight" type="alongLine" length="Line_A_B"/>',
          "</calculation>",
          "<modeling>",
          '<point id="11" idObject="2" type="modeling"/>',
          '<point id="12" idObject="1" type="modeling"/>',
          '<point id="13" idObject="3" type="modeling"/>',
          '<path id="20" name="dart" type="2">',
          "<nodes>",
          '<node idObject="11" type="NodePoint"/>',
          '<node idObject="12" type="NodePoint"/>',
          '<node idObject="13" type="NodePoint"/>',
          "</nodes>",
          "</path>",
          '<path id="40" name="seam" seam="armhole" type="1">',
          "<nodes>",
          '<node idObject="51" type="NodePoint" passmark="1" position="0.5"/>',
          "</nodes>",
          "</path>",
          "</modeling>",
          "</draw>",
          "</pattern>",
          ""
        ].join("\n"),
        "utf8"
      );

      const result = await loadProjectedPart(join(root, "parts/body/part.loom"));

      expect(result.ok).toBe(true);
      expect(Object.keys(result.ok ? (result.value.notches ?? {}) : {})).toEqual([
        "val:block:notch:armhole:51"
      ]);
      // ダーツも消えない(絞ると <iPaths> が無いので 0 本になってしまう)。
      expect(Object.keys(result.ok ? (result.value.darts ?? {}) : {})).toEqual(["val:block:dart:20"]);
      expect(result.diagnostics).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not accept a display label for an unnamed detail as a real piece name", async () => {
    // 守る仕様: listValDetails は名前の無い detail に表示ラベル(detail#<id>)を割り当てるが、それは一覧で一意に
    //           指すための代用であって .val 上の piece 名ではない。ラベルで一致を見ると「piece はある」と誤判定し、
    //           射影器は無名 detail を飛ばすので空射影のまま警告も出ない、という黙り方に戻る。
    const root = await mkdtemp(join(tmpdir(), "loomit-piece-label-"));

    try {
      await mkdir(join(root, "parts/body"), { recursive: true });
      await writeFile(
        join(root, "loomit.yml"),
        [
          "schema: loomit.project.v0",
          "name: labelled",
          "garment: blouse",
          "parts:",
          "  body: ./parts/body/part.loom"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(root, "parts/body/part.loom"),
        [
          "schema: loomit.part.v0",
          "name: body",
          "variant: v1",
          "type: body",
          "files:",
          "  source: body.val",
          "  piece: detail#9"
        ].join("\n"),
        "utf8"
      );
      // name 属性を持たない detail。listValDetails はこれを "detail#9" と表示する。
      await writeFile(
        join(root, "body.val"),
        [
          "<pattern>",
          '<draw name="d">',
          "<details>",
          '<detail id="9">',
          "<nodes>",
          '<node idObject="70" passmark="true" passmarkLine="vMark" type="NodePoint"/>',
          "</nodes>",
          "</detail>",
          "</details>",
          "</draw>",
          "</pattern>",
          ""
        ].join("\n"),
        "utf8"
      );

      const result = await loadProjectedPart(join(root, "parts/body/part.loom"));

      expect(result.ok).toBe(true);
      expect(result.ok ? result.value.notches : undefined).toBeUndefined();
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        "PART_SOURCE_VAL_PIECE_NOT_FOUND"
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stays silent about a missing files.piece when the .val holds a single detail", async () => {
    // 守る仕様(must-not-fire): 混ざる相手がいない .val(detail が1枚以下)では警告しない。detail を持たない
    //           Seamly2D 方言の .val も同じ扱いで、既存 project に新しい警告を出さない。
    const { root, partFilePath } = await makeTempPart(true);

    try {
      await writeFile(join(root, "body.val"), valWithPassmark("1"), "utf8");

      const result = await loadProjectedPart(partFilePath);

      expect(result.ok).toBe(true);
      expect(Object.keys(result.ok ? (result.value.notches ?? {}) : {})).toEqual([
        "val:body:notch:1"
      ]);
      expect(result.diagnostics).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
