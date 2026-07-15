import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { findCollidingRoleNames, runAddCommand } from "../src/commands/add.js";
import { EndOfInputError } from "../src/prompter.js";
import type { Prompter } from "../src/prompter.js";

// 衝突が無ければ --yes は prompt しない。呼ばれたら即失敗させ、「衝突なし = prompt ゼロ」を保証する。
const throwingPrompter: Prompter = {
  input: () => Promise.reject(new Error("input() must not be called without a collision")),
  select: () => Promise.reject(new Error("select() must not be called with --yes")),
  confirm: () => Promise.reject(new Error("confirm() must not be called with --yes")),
  close: () => {}
};

// 衝突分の role 入力をキューで返す scripted prompter(B の対話分を決定的に流す)。
function scriptedPrompter(inputs: readonly string[]): Prompter {
  const queue = [...inputs];
  return {
    input: () => Promise.resolve(queue.shift() ?? ""),
    select: () => Promise.reject(new Error("select() not expected")),
    confirm: () => Promise.reject(new Error("confirm() not expected")),
    close: () => {}
  };
}

// パイプ入力が尽きた状況(衝突分の role を埋められない)を模す prompter。
const eofPrompter: Prompter = {
  input: () => Promise.reject(new EndOfInputError()),
  select: () => Promise.reject(new Error("select() not expected")),
  confirm: () => Promise.reject(new Error("confirm() not expected")),
  close: () => {}
};

// front / back の2ピースを持つ最小 .val(listValDetails は <draw> 内の <detail name> を拾う)。
const TWO_PIECE_VAL = [
  "<pattern>",
  '  <draw name="knickers">',
  '    <detail name="front"></detail>',
  '    <detail name="back"></detail>',
  "  </draw>",
  "</pattern>",
  ""
].join("\n");

async function makeProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "loomit-add-yes-"));

  await writeFile(
    join(root, "loomit.yml"),
    ["schema: loomit.project.v0", "name: add-yes", "garment: knickers", "parts: {}"].join("\n"),
    "utf8"
  );
  await writeFile(join(root, "knickers.val"), TWO_PIECE_VAL, "utf8");

  return root;
}

describe("loom add --yes", () => {
  it("scaffolds one part per detail with defaults and asks nothing", async () => {
    const root = await makeProject();
    const out: string[] = [];
    const err: string[] = [];

    try {
      const code = await runAddCommand(["knickers.val", "--yes"], {
        cwd: root,
        stdout: (text) => out.push(text),
        stderr: (text) => err.push(text),
        prompter: throwingPrompter
      });

      expect(err.join("")).toBe("");
      expect(code).toBe(0);

      // 両ピースが loomit.yml に role をキーに登録される。
      const project = await readFile(join(root, "loomit.yml"), "utf8");
      expect(project).toContain("front: ./parts/front/part.loom");
      expect(project).toContain("back: ./parts/back/part.loom");

      // 各 part は type=body / variant=v1 / files.piece=ピース名 / 連結なし(デフォルト)。
      const front = await readFile(join(root, "parts/front/part.loom"), "utf8");
      expect(front).toContain("name: front");
      expect(front).toContain("type: body");
      expect(front).toContain("variant: v1");
      expect(front).toContain("piece: front");
      expect(front).not.toContain("connectors");

      const back = await readFile(join(root, "parts/back/part.loom"), "utf8");
      expect(back).toContain("piece: back");
      expect(back).not.toContain("connectors");

      // まとめの案内を出す。
      expect(out.join("")).toContain("Added 2 parts");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to a single default part when the .val has no detail pieces", async () => {
    const root = await mkdtemp(join(tmpdir(), "loomit-add-yes-single-"));
    const out: string[] = [];
    const err: string[] = [];

    try {
      await writeFile(
        join(root, "loomit.yml"),
        ["schema: loomit.project.v0", "name: add-yes-single", "garment: block", "parts: {}"].join(
          "\n"
        ),
        "utf8"
      );
      // draw も detail も無い .val は旧来の 1 part 経路に倒れる(name は .val 名から既定)。
      await writeFile(join(root, "block.val"), "<pattern></pattern>\n", "utf8");

      const code = await runAddCommand(["block.val", "--yes"], {
        cwd: root,
        stdout: (text) => out.push(text),
        stderr: (text) => err.push(text),
        prompter: throwingPrompter
      });

      expect(err.join("")).toBe("");
      expect(code).toBe(0);

      // 旧来の単一 part 経路は role を分けず role==type で登録するため、ディレクトリ/キーは type の
      // 既定 "body" になる(.val 名 "block" は part.loom の name ラベルとして残る)。--yes はこの既存挙動を踏襲。
      const project = await readFile(join(root, "loomit.yml"), "utf8");
      expect(project).toContain("body: ./parts/body/part.loom");

      const part = await readFile(join(root, "parts/body/part.loom"), "utf8");
      expect(part).toContain("name: block");
      expect(part).toContain("type: body");
      expect(part).toContain("variant: v1");
      expect(part).not.toContain("connectors");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the source .val when a piece is skipped so it can still be added by hand", async () => {
    // 元 .val を parts/ 内に置く = 消費(削除)条件が成立する配置。安全でない名前("a/b")のピースが
    // skip される場合、案内どおり後から手動追加できるよう元 .val を残す(P1 の退行防止)。
    const root = await mkdtemp(join(tmpdir(), "loomit-add-yes-skip-"));
    const out: string[] = [];
    const err: string[] = [];

    try {
      await writeFile(
        join(root, "loomit.yml"),
        ["schema: loomit.project.v0", "name: add-yes-skip", "garment: knickers", "parts: {}"].join(
          "\n"
        ),
        "utf8"
      );
      await mkdir(join(root, "parts"));
      const source = join(root, "parts", "import.val");
      await writeFile(
        source,
        [
          "<pattern>",
          '  <draw name="knickers">',
          '    <detail name="front"></detail>',
          '    <detail name="a/b"></detail>',
          "  </draw>",
          "</pattern>",
          ""
        ].join("\n"),
        "utf8"
      );

      const code = await runAddCommand(["parts/import.val", "--yes"], {
        cwd: root,
        stdout: (text) => out.push(text),
        stderr: (text) => err.push(text),
        prompter: throwingPrompter
      });

      expect(code).toBe(0);
      // 安全名のピースは追加される。
      expect(await readFile(join(root, "parts/front/part.loom"), "utf8")).toContain("piece: front");
      // 安全でない名前は skip され、明示される。
      expect(out.join("")).toContain('Skipped "a/b"');
      // P1: parts/ 内の元 .val は消費されず残る(skip 分を後から手動追加できる)。
      const sourceKept = await readFile(source, "utf8").then(
        () => true,
        () => false
      );
      expect(sourceKept).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a .val with duplicate detail names instead of scaffolding", async () => {
    // detail "front" が2つ = piece 名(=DXF BLOCK identity)が衝突。role を分けても files.piece は同じで
    // Seamlint が物理ピースを区別できないため、prompt せず何も書かずにエラーで止める(Valentina で名前を分けさせる)。
    const root = await mkdtemp(join(tmpdir(), "loomit-add-dup-"));
    const out: string[] = [];
    const err: string[] = [];

    try {
      await writeFile(
        join(root, "loomit.yml"),
        ["schema: loomit.project.v0", "name: add-dup", "garment: knickers", "parts: {}"].join("\n"),
        "utf8"
      );
      await writeFile(
        join(root, "dup.val"),
        [
          "<pattern>",
          '  <draw name="knickers">',
          '    <detail name="front"></detail>',
          '    <detail name="front"></detail>',
          "  </draw>",
          "</pattern>",
          ""
        ].join("\n"),
        "utf8"
      );

      const code = await runAddCommand(["dup.val", "--yes"], {
        cwd: root,
        stdout: (text) => out.push(text),
        stderr: (text) => err.push(text),
        prompter: throwingPrompter
      });

      expect(code).toBe(1);
      expect(err.join("")).toContain("Duplicate detail name(s) in the .val (front)");
      // 何も書かない: loomit.yml は空のまま、parts/front も作られない。
      expect(await readFile(join(root, "loomit.yml"), "utf8")).toContain("parts: {}");
      const wrotePart = await readFile(join(root, "parts/front/part.loom"), "utf8").then(
        () => true,
        () => false
      );
      expect(wrotePart).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("treats detail names that differ only in case as duplicates", async () => {
    // Seamlint は BLOCK 名を大文字化して照合するので "Front" と "front" は同じ BLOCK に衝突する。
    // case 違いも handoff を壊すため弾く(projectNotchesFromVal の case-sensitive 判定が取りこぼす穴も塞ぐ)。
    const root = await mkdtemp(join(tmpdir(), "loomit-add-dup-case-"));
    const out: string[] = [];
    const err: string[] = [];

    try {
      await writeFile(
        join(root, "loomit.yml"),
        ["schema: loomit.project.v0", "name: add-dup-case", "garment: knickers", "parts: {}"].join(
          "\n"
        ),
        "utf8"
      );
      await writeFile(
        join(root, "dup.val"),
        [
          "<pattern>",
          '  <draw name="knickers">',
          '    <detail name="Front"></detail>',
          '    <detail name="front"></detail>',
          "  </draw>",
          "</pattern>",
          ""
        ].join("\n"),
        "utf8"
      );

      const code = await runAddCommand(["dup.val", "--yes"], {
        cwd: root,
        stdout: (text) => out.push(text),
        stderr: (text) => err.push(text),
        prompter: throwingPrompter
      });

      expect(code).toBe(1);
      expect(err.join("")).toContain("Duplicate detail name(s) in the .val");
      expect(await readFile(join(root, "loomit.yml"), "utf8")).toContain("parts: {}");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects duplicate detail names in interactive mode too (no --yes)", async () => {
    // 対話経路も同じゲートで守る。prompter を触る前に弾くので、throwingPrompter が呼ばれてはならない。
    const root = await mkdtemp(join(tmpdir(), "loomit-add-dup-interactive-"));
    const out: string[] = [];
    const err: string[] = [];

    try {
      await writeFile(
        join(root, "loomit.yml"),
        ["schema: loomit.project.v0", "name: add-dup-i", "garment: knickers", "parts: {}"].join(
          "\n"
        ),
        "utf8"
      );
      await writeFile(
        join(root, "dup.val"),
        [
          "<pattern>",
          '  <draw name="knickers">',
          '    <detail name="front"></detail>',
          '    <detail name="front"></detail>',
          "  </draw>",
          "</pattern>",
          ""
        ].join("\n"),
        "utf8"
      );

      const code = await runAddCommand(["dup.val"], {
        cwd: root,
        stdout: (text) => out.push(text),
        stderr: (text) => err.push(text),
        prompter: throwingPrompter
      });

      expect(code).toBe(1);
      expect(err.join("")).toContain("Duplicate detail name(s) in the .val (front)");
      const wrotePart = await readFile(join(root, "parts/front/part.loom"), "utf8").then(
        () => true,
        () => false
      );
      expect(wrotePart).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("says the role already exists when re-adding a .val whose pieces are already parts", async () => {
    // ユーザ実例の再現: 同じ .val をもう一度 add。detail "front" は既にプロジェクトの part role なので、
    // 「.val 内重複」ではなく「もう add 済みかも」を真っ先に伝える(一番効く情報)。scripted で front2 に。
    const root = await mkdtemp(join(tmpdir(), "loomit-add-yes-readd-"));
    const out: string[] = [];
    const err: string[] = [];

    try {
      await writeFile(
        join(root, "loomit.yml"),
        [
          "schema: loomit.project.v0",
          "name: add-yes-readd",
          "garment: knickers",
          "parts:",
          "  front: ./parts/front/part.loom",
          "  back: ./parts/back/part.loom"
        ].join("\n"),
        "utf8"
      );
      await writeFile(join(root, "knickers.val"), TWO_PIECE_VAL, "utf8");

      const code = await runAddCommand(["knickers.val", "--yes"], {
        cwd: root,
        stdout: (text) => out.push(text),
        stderr: (text) => err.push(text),
        // front も back も既存 role と衝突する。両方に distinct な role を訊かれる。
        prompter: scriptedPrompter(["front2", "back2"])
      });

      expect(err.join("")).toBe("");
      expect(code).toBe(0);
      // 既存プロジェクト由来の衝突なので「もう add 済みかも」を出し、.val 内重複の文言は出さない。
      expect(out.join("")).toContain('Part role "front" already exists in this project');
      expect(out.join("")).toContain("you may have already run loom add on this .val");
      expect(out.join("")).not.toContain("repeats another piece in this .val");
      // 既存 front/back は残し、対話で決めた front2/back2 を足す。
      const project = await readFile(join(root, "loomit.yml"), "utf8");
      expect(project).toContain("front: ./parts/front/part.loom");
      expect(project).toContain("front2: ./parts/front2/part.loom");
      expect(project).toContain("back2: ./parts/back2/part.loom");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails cleanly without partial writes when collision input is unavailable", async () => {
    // 既存 role(front/back)と衝突する .val を再 add。衝突分の role を訊く段で入力が尽きる(パイプ想定)。
    // role は書き込み前に確定するので、新しい part は1つも書かれない(既存 front/back はそのまま)。
    const root = await mkdtemp(join(tmpdir(), "loomit-add-yes-eof-"));
    const out: string[] = [];
    const err: string[] = [];

    try {
      await writeFile(
        join(root, "loomit.yml"),
        [
          "schema: loomit.project.v0",
          "name: add-yes-eof",
          "garment: knickers",
          "parts:",
          "  front: ./parts/front/part.loom",
          "  back: ./parts/back/part.loom"
        ].join("\n"),
        "utf8"
      );
      await writeFile(join(root, "knickers.val"), TWO_PIECE_VAL, "utf8");

      const code = await runAddCommand(["knickers.val", "--yes"], {
        cwd: root,
        stdout: (text) => out.push(text),
        stderr: (text) => err.push(text),
        prompter: eofPrompter
      });

      expect(code).toBe(1);
      expect(err.join("")).toContain("Input ended before all colliding roles");
      // 部分適用なし: 新 role(front2 等)は書かれず、loomit.yml は既存の front/back だけ。
      const project = await readFile(join(root, "loomit.yml"), "utf8");
      expect(project).not.toContain("front2");
      const wrotePart = await readFile(join(root, "parts/front2/part.loom"), "utf8").then(
        () => true,
        () => false
      );
      expect(wrotePart).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not open stdin on collision in a non-interactive shell", async () => {
    // prompter を注入せず、非対話(isTTY=false)で衝突を起こす。--yes は stdin を開かず clean fail し
    // (automation を止めない契約)、part を1つも書かない。isTTY は runner 依存なので明示的に false に固定する。
    const root = await mkdtemp(join(tmpdir(), "loomit-add-yes-noninteractive-"));
    const out: string[] = [];
    const err: string[] = [];
    const originalIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = false;

    try {
      await writeFile(
        join(root, "loomit.yml"),
        [
          "schema: loomit.project.v0",
          "name: add-yes-ni",
          "garment: knickers",
          "parts:",
          "  front: ./parts/front/part.loom",
          "  back: ./parts/back/part.loom"
        ].join("\n"),
        "utf8"
      );
      await writeFile(join(root, "knickers.val"), TWO_PIECE_VAL, "utf8");

      // prompter は渡さない = 実際の TTY 判定(false に固定済み)に委ねる。既存 role と衝突するので prompt が要るが、
      // 非対話では stdin を開かず clean fail する。
      const code = await runAddCommand(["knickers.val", "--yes"], {
        cwd: root,
        stdout: (text) => out.push(text),
        stderr: (text) => err.push(text)
      });

      expect(code).toBe(1);
      expect(err.join("")).toContain("non-interactive shell");
      // 部分適用なし: 新 role(front2 等)は書かれない。
      const project = await readFile(join(root, "loomit.yml"), "utf8");
      expect(project).not.toContain("front2");
    } finally {
      process.stdin.isTTY = originalIsTTY;
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("findCollidingRoleNames", () => {
  it("flags exact duplicates in either filesystem mode", () => {
    // 完全一致はどちらの FS でも role 衝突する。初出の綴りを1回だけ返す。
    expect(findCollidingRoleNames(["front", "back", "front"], false)).toEqual(["front"]);
    expect(findCollidingRoleNames(["front", "back", "front"], true)).toEqual(["front"]);
  });

  it("flags case-only differences only on case-insensitive filesystems", () => {
    // 大文字小文字を区別しない FS(Windows/macOS): Front と front は同じ parts/ に解決 = 衝突。両綴りを返す。
    expect(findCollidingRoleNames(["Front", "front"], true)).toEqual(["Front", "front"]);
    // 区別する FS(Linux 等): 別ディレクトリなので衝突しない。
    expect(findCollidingRoleNames(["Front", "front"], false)).toEqual([]);
  });

  it("returns nothing when every name is distinct", () => {
    expect(findCollidingRoleNames(["front", "back", "sleeve"], true)).toEqual([]);
  });
});
