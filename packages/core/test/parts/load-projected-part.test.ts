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
