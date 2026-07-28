import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { addPartToProject } from "../../src/index.js";

async function makeProject(): Promise<string> {
  const tempRoot = await mkdtemp(join(tmpdir(), "loomit-add-part-"));

  await writeFile(
    join(tempRoot, "loomit.yml"),
    ["schema: loomit.project.v0", "name: add-blouse", "garment: blouse", "parts: {}"].join("\n"),
    "utf8"
  );

  return tempRoot;
}

describe("addPartToProject", () => {
  it("generates part.loom referencing a project .val in place, without copying it", async () => {
    // 守る仕様: project 内の .val はその場を参照する。コピーも move もせず、files.source には project
    // root 相対パスを書く。part ディレクトリに複製を作らないことがこの設計の目的なので、
    // parts/<role>/ に .val が生まれないことも併せて固定する。
    const projectRoot = await makeProject();
    const valPath = join(projectRoot, "body.val");

    try {
      await writeFile(valPath, "body source\n", "utf8");

      const result = await addPartToProject({
        projectPath: projectRoot,
        valPath,
        name: "body",
        type: "body",
        variant: "v1",
        connectors: [{ id: "armhole", lengthMm: 469 }]
      });

      expect(result.ok).toBe(true);

      if (!result.ok) {
        return;
      }

      // 元の .val はその場に残り、part ディレクトリには複製が作られない。
      expect(await readFile(valPath, "utf8")).toBe("body source\n");
      expect(existsSync(join(projectRoot, "parts/body/body.val"))).toBe(false);
      expect(result.value.sourceFilePath).toBe(valPath);
      expect(result.value.sourceCopied).toBe(false);

      // 生成された part は schema を満たし、回答が反映される。
      expect(result.value.part).toEqual({
        schema: "loomit.part.v0",
        name: "body",
        variant: "v1",
        type: "body",
        files: { source: "body.val" },
        connectors: { armhole: { type: "armhole", length_mm: 469 } }
      });

      // loomit.yml の parts に project 相対パスで登録される。
      expect(result.value.project.parts).toEqual({ body: "./parts/body/part.loom" });
      expect(await readFile(join(projectRoot, "loomit.yml"), "utf8")).toContain(
        "body: ./parts/body/part.loom"
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("adds a connector without a length as identity only (deferred measurement)", async () => {
    // 守る仕様: length_mm 未測定の connector は type(identity)だけで生成し、length_mm は載せない。
    // loom add は幾何の測定値を手打ちさせず、実測は後で Seamlint(loom slnt check)が担う前提。
    const projectRoot = await makeProject();
    const valPath = join(projectRoot, "body.val");

    try {
      await writeFile(valPath, "body source\n", "utf8");

      const result = await addPartToProject({
        projectPath: projectRoot,
        valPath,
        name: "body",
        type: "body",
        variant: "v1",
        connectors: [{ id: "armhole" }]
      });

      expect(result.ok).toBe(true);

      if (!result.ok) {
        return;
      }

      expect(result.value.part.connectors).toEqual({ armhole: { type: "armhole" } });
      const generatedPart = await readFile(join(projectRoot, "parts/body/part.loom"), "utf8");
      expect(generatedPart).not.toContain("length_mm");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("writes the connector type separately from the record-key id", async () => {
    // 守る仕様: connector の id(record キー=一意な rendezvous)と type(種類ラベル)は別軸。type を渡すと
    // id とは独立に書かれ、同じ type の別の縫い目を一意 id を保ったまま表せる(type: input.id の旧挙動を捨てる)。
    const projectRoot = await makeProject();
    const valPath = join(projectRoot, "body.val");

    try {
      await writeFile(valPath, "body source\n", "utf8");

      const result = await addPartToProject({
        projectPath: projectRoot,
        valPath,
        name: "body",
        type: "body",
        variant: "v1",
        connectors: [
          { id: "side_left", type: "side" },
          { id: "side_right", type: "side" }
        ]
      });

      expect(result.ok).toBe(true);

      if (!result.ok) {
        return;
      }

      // id はそれぞれ別の record キー、type はどちらも "side"(同じ種類の別の縫い目)。
      expect(result.value.part.connectors).toEqual({
        side_left: { type: "side" },
        side_right: { type: "side" }
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("registers a project role separately from part.type", async () => {
    // 守る仕様: addPartToProject は role(front) と part.type(body) を別々に保存できる。
    const projectRoot = await makeProject();
    const valPath = join(projectRoot, "front.val");

    try {
      await writeFile(valPath, "front source\n", "utf8");

      const result = await addPartToProject({
        projectPath: projectRoot,
        valPath,
        name: "front",
        role: "front",
        type: "body",
        variant: "v1",
        piece: "front"
      });

      expect(result.ok).toBe(true);

      if (!result.ok) {
        return;
      }

      expect(result.value.role).toBe("front");
      expect(result.value.part.type).toBe("body");
      expect(result.value.part.files?.piece).toBe("front");
      expect(result.value.project.parts).toEqual({ front: "./parts/front/part.loom" });
      expect(await readFile(join(projectRoot, "parts/front/part.loom"), "utf8")).toContain(
        "type: body"
      );
      expect(await readFile(join(projectRoot, "parts/front/part.loom"), "utf8")).toContain(
        "piece: front"
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("references a .val that lives under parts/ without moving or copying it", async () => {
    // 守る仕様: parts/ 直下に置かれた .val も project 内なのでその場を参照する。files.source には
    // project root 相対の "parts/waist.val" を書く。
    //
    // NOTE: 以前この位置には逆の仕様(取り込み後に元を削除する = 実質 move)のテストがあった。move は
    // 「コピーを作るから元が二重になる」ことへの対処であり、コピーをやめた今は元を消す理由が無い
    // (ユーザーが頼んでいない削除をしないほうがよい)。
    const projectRoot = await makeProject();
    const valPath = join(projectRoot, "parts", "waist.val");

    try {
      await mkdir(join(projectRoot, "parts"), { recursive: true });
      await writeFile(valPath, "waist source\n", "utf8");

      const result = await addPartToProject({
        projectPath: projectRoot,
        valPath,
        name: "waist",
        type: "body",
        variant: "v1"
      });

      expect(result.ok).toBe(true);

      if (!result.ok) {
        return;
      }

      // 元ファイルはその場に残り、複製も作られない。
      expect(await readFile(valPath, "utf8")).toBe("waist source\n");
      expect(existsSync(join(projectRoot, "parts/body/waist.val"))).toBe(false);
      // files.source は project root 相対(POSIX 区切り)。
      expect(result.value.part.files?.source).toBe("parts/waist.val");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("imports a .val from outside the project into the project root once", async () => {
    // 守る仕様: project 外の .val は schema(絶対パス・".." を拒否)の都合で参照できないため取り込む。
    // 置き先は part ディレクトリではなく project root ── 1 .val→N part で複製が増えないようにする。
    const projectRoot = await makeProject();
    const outside = await mkdtemp(join(tmpdir(), "loomit-add-outside-"));
    const valPath = join(outside, "sleeve.val");

    try {
      await writeFile(valPath, "sleeve source\n", "utf8");

      const result = await addPartToProject({
        projectPath: projectRoot,
        valPath,
        name: "sleeve",
        type: "sleeve",
        variant: "v1"
      });

      expect(result.ok).toBe(true);

      if (!result.ok) {
        return;
      }

      // project root に1つだけ置かれ、part ディレクトリには置かれない。
      expect(await readFile(join(projectRoot, "sleeve.val"), "utf8")).toBe("sleeve source\n");
      expect(existsSync(join(projectRoot, "parts/sleeve/sleeve.val"))).toBe(false);
      expect(result.value.part.files?.source).toBe("sleeve.val");
      expect(result.value.sourceCopied).toBe(true);
      // 取り込み元は消さない(project 外のファイルは Loomit の持ち物ではない)。
      expect(await readFile(valPath, "utf8")).toBe("sleeve source\n");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("reuses an identical .val already at the project root instead of copying again", async () => {
    // 守る仕様: 取り込み先に同名かつ同一内容のファイルが既にあれば、上書きせずそれを参照する。
    // 1 .val→N part の2ピース目以降がここに来るので、複製が増えないことをここで固定する。
    const projectRoot = await makeProject();
    const outside = await mkdtemp(join(tmpdir(), "loomit-add-outside-same-"));
    const valPath = join(outside, "shared.val");

    try {
      await writeFile(valPath, "shared source\n", "utf8");
      await writeFile(join(projectRoot, "shared.val"), "shared source\n", "utf8");

      const result = await addPartToProject({
        projectPath: projectRoot,
        valPath,
        name: "front",
        role: "front",
        type: "body",
        variant: "v1"
      });

      expect(result.ok).toBe(true);
      expect(result.ok ? result.value.sourceCopied : true).toBe(false);
      expect(result.ok ? result.value.part.files?.source : "").toBe("shared.val");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite a different file with the same name at the project root", async () => {
    // 守る仕様: 取り込み先に同名だが内容の違うファイルがあれば PART_ADD_SOURCE_TARGET_CONFLICT で
    // 失敗し、何も書き込まない。黙って上書きすると、既に他の part が読んでいるファイルを別物に
    // 差し替えてしまう(R1: 正本を壊さない)。
    const projectRoot = await makeProject();
    const outside = await mkdtemp(join(tmpdir(), "loomit-add-outside-diff-"));
    const valPath = join(outside, "shared.val");

    try {
      await writeFile(valPath, "incoming source\n", "utf8");
      await writeFile(join(projectRoot, "shared.val"), "existing source\n", "utf8");

      const result = await addPartToProject({
        projectPath: projectRoot,
        valPath,
        name: "front",
        role: "front",
        type: "body",
        variant: "v1"
      });

      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.diagnostics[0]?.code).toBe(
        "PART_ADD_SOURCE_TARGET_CONFLICT"
      );
      // 既存ファイルは変わらず、part も作られない。
      expect(await readFile(join(projectRoot, "shared.val"), "utf8")).toBe("existing source\n");
      expect(existsSync(join(projectRoot, "parts/front"))).toBe(false);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects a directory as the .val source before writing anything", async () => {
    // 守る仕様: 取り込み対象が通常ファイルでなければ PART_ADD_SOURCE_NOT_A_FILE で失敗し、何も書かない。
    //
    // 回帰防止: project 内の .val をコピーせずその場参照するようにした時点で、この検証が要るようになった。
    // 以前は必ず copyFile が走り、ディレクトリなら EISDIR で add 時に落ちていた(コピーが暗黙の検証を
    // 兼ねていた)。明示しないと、ディレクトリを指す part.loom が書けてしまい、失敗が後段の射影まで遅れる。
    const projectRoot = await makeProject();
    const valPath = join(projectRoot, "notafile.val");

    try {
      await mkdir(valPath, { recursive: true });

      const result = await addPartToProject({
        projectPath: projectRoot,
        valPath,
        name: "body",
        type: "body",
        variant: "v1"
      });

      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.diagnostics[0]?.code).toBe("PART_ADD_SOURCE_NOT_A_FILE");
      // part も loomit.yml の登録も作られない。
      expect(existsSync(join(projectRoot, "parts/body"))).toBe(false);
      expect(await readFile(join(projectRoot, "loomit.yml"), "utf8")).toContain("parts: {}");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects a directory as the .val source from outside the project too", async () => {
    // 守る仕様: project 外の取り込み経路でも同じガードが効く。ここは copyFile が走る経路だが、
    // 失敗を PART_ADD_FAILED(汎用)ではなく原因の分かる診断で返す。
    const projectRoot = await makeProject();
    const outside = await mkdtemp(join(tmpdir(), "loomit-add-outside-dir-"));
    const valPath = join(outside, "notafile.val");

    try {
      await mkdir(valPath, { recursive: true });

      const result = await addPartToProject({
        projectPath: projectRoot,
        valPath,
        name: "body",
        type: "body",
        variant: "v1"
      });

      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.diagnostics[0]?.code).toBe("PART_ADD_SOURCE_NOT_A_FILE");
      expect(existsSync(join(projectRoot, "notafile.val"))).toBe(false);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("refuses a .val symlink inside the project that points outside it", async (ctx) => {
    // 守る仕様: 内外の判定は realpath で行う(R2)。project 内に置いた symlink が外を指しているとき、
    // パス文字列だけ見て「内側」と扱うと、その symlink パスが files.source に記録される。下流(射影・
    // Seamlint handoff・build の output コピー)は symlink を辿るので、project 外のファイルを読み・
    // 複製する経路になる。PART_ADD_SOURCE_ESCAPES_PROJECT で止め、何も書かない。
    //
    // 回帰防止: コピーしていた頃は copyFile が内容を実体として複製していたためこの経路が無く、
    // 「その場参照」にした変更で初めて到達可能になった。
    const projectRoot = await makeProject();
    const outside = await mkdtemp(join(tmpdir(), "loomit-add-symlink-"));
    const realVal = join(outside, "real.val");
    const linkPath = join(projectRoot, "link.val");

    try {
      await writeFile(realVal, "outside source\n", "utf8");

      try {
        await symlink(realVal, linkPath, "file");
      } catch {
        // Windows では symlink 作成に権限が要る。作れない環境では検証できないので skip する
        // (通ったことにして緑にしない)。
        ctx.skip();
        return;
      }

      const result = await addPartToProject({
        projectPath: projectRoot,
        valPath: linkPath,
        name: "body",
        type: "body",
        variant: "v1"
      });

      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.diagnostics[0]?.code).toBe("PART_ADD_SOURCE_ESCAPES_PROJECT");
      expect(existsSync(join(projectRoot, "parts/body"))).toBe(false);
      expect(await readFile(join(projectRoot, "loomit.yml"), "utf8")).toContain("parts: {}");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("refuses a .val reached through a directory link that leaves the project", async () => {
    // 守る仕様: 実体境界の判定(R2)は、.val 自身が symlink でなくても効く。project 内のディレクトリ
    // リンク越しに外のファイルへ届く経路も塞ぐ。
    //
    // このテストだけ symlink ではなくディレクトリリンクを使うのは移植性のため: Windows で file symlink を
    // 作るには Developer Mode か管理者権限が要る(EPERM で skip になる)が、junction は権限不要で作れ、
    // POSIX では type 引数が無視されて通常の symlink になる。主要ガードをどの OS でも実行できるようにする。
    const projectRoot = await makeProject();
    const outside = await mkdtemp(join(tmpdir(), "loomit-add-linkdir-"));

    try {
      await writeFile(join(outside, "outside.val"), "outside source\n", "utf8");
      await symlink(outside, join(projectRoot, "linked"), "junction");

      const result = await addPartToProject({
        projectPath: projectRoot,
        valPath: join(projectRoot, "linked", "outside.val"),
        name: "body",
        type: "body",
        variant: "v1"
      });

      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.diagnostics[0]?.code).toBe("PART_ADD_SOURCE_ESCAPES_PROJECT");
      expect(existsSync(join(projectRoot, "parts/body"))).toBe(false);
      expect(await readFile(join(projectRoot, "loomit.yml"), "utf8")).toContain("parts: {}");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("accepts a .val symlink whose target is also inside the project", async (ctx) => {
    // 守る仕様: 実体も project 内なら symlink でも通す(境界の目的は「外へ出さない」ことなので、
    // project 内で完結する symlink まで塞がない)。files.source には実体側の相対パスを書く。
    const projectRoot = await makeProject();
    const realVal = join(projectRoot, "real.val");
    const linkPath = join(projectRoot, "link.val");

    try {
      await writeFile(realVal, "inside source\n", "utf8");

      try {
        await symlink(realVal, linkPath, "file");
      } catch {
        ctx.skip();
        return;
      }

      const result = await addPartToProject({
        projectPath: projectRoot,
        valPath: linkPath,
        name: "body",
        type: "body",
        variant: "v1"
      });

      expect(result.ok).toBe(true);
      expect(result.ok ? result.value.part.files?.source : "").toBe("real.val");
      expect(result.ok ? result.value.sourceCopied : true).toBe(false);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("refuses when the import target at the project root is a symlink pointing outside", async (ctx) => {
    // 守る仕様: 実体境界は「渡された .val」だけでなく「取り込み先に既にある同名ファイル」にも効く。
    // 内容一致で参照に落とす前に realpath を見ないと、渡された側だけ守っても「project 内の名前で
    // project 外を読む」状態が同じように成立する(下流は symlink を辿る)。
    //
    // 内容が違う場合は PART_ADD_SOURCE_TARGET_CONFLICT で止まるため、この穴は同一内容のときだけ
    // 通る。条件は狭いが R2 が防ぐべきものそのものなので塞ぐ。
    const projectRoot = await makeProject();
    const outside = await mkdtemp(join(tmpdir(), "loomit-add-target-symlink-"));
    const outsideTarget = join(outside, "shared.val");
    const incoming = join(outside, "incoming", "shared.val");
    const linkAtRoot = join(projectRoot, "shared.val");

    try {
      await writeFile(outsideTarget, "shared source\n", "utf8");
      await mkdir(join(outside, "incoming"), { recursive: true });
      // 取り込もうとする .val は project 外の別ファイルだが、内容は同一。
      await writeFile(incoming, "shared source\n", "utf8");

      try {
        await symlink(outsideTarget, linkAtRoot, "file");
      } catch {
        ctx.skip();
        return;
      }

      const result = await addPartToProject({
        projectPath: projectRoot,
        valPath: incoming,
        name: "body",
        type: "body",
        variant: "v1"
      });

      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.diagnostics[0]?.code).toBe("PART_ADD_SOURCE_ESCAPES_PROJECT");
      expect(existsSync(join(projectRoot, "parts/body"))).toBe(false);
      // 外のファイルは書き換わっていない(symlink 越しの上書きが起きていない)。
      expect(await readFile(outsideTarget, "utf8")).toBe("shared source\n");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("does not delete the import target when another writer created it first", async (ctx) => {
    // 守る仕様: ロールバックで消してよいのは「この呼び出しが実際に作ったコピー」だけ。COPYFILE_EXCL が
    // EEXIST で落ちたときそのファイルを作ったのは競合する別の書き手なので、失敗の後始末で消してはいけない。
    //
    // 回帰防止: ロールバック条件を「コピーする計画だったか」(sourcePlan.copy)で書くと、この経路で
    // 他人のファイルを削除する。COPYFILE_EXCL を入れたことで生まれた経路なので、条件は実績で持つ。
    //
    // 競合を仕込まずに EEXIST を起こすため dangling symlink を使う: 存在確認の access() は追跡して
    // ENOENT(= 無い → コピーする計画)になる一方、COPYFILE_EXCL はディレクトリエントリを見て EEXIST を返す。
    const projectRoot = await makeProject();
    const outside = await mkdtemp(join(tmpdir(), "loomit-add-race-"));
    const valPath = join(outside, "shared.val");
    const targetLink = join(projectRoot, "shared.val");

    try {
      await writeFile(valPath, "incoming source\n", "utf8");

      try {
        // 実体の無い相手を指す symlink。project root に「同名エントリはあるが access では見えない」状態を作る。
        await symlink(join(outside, "missing.val"), targetLink, "file");
      } catch {
        ctx.skip();
        return;
      }

      const result = await addPartToProject({
        projectPath: projectRoot,
        valPath,
        name: "body",
        type: "body",
        variant: "v1"
      });

      expect(result.ok).toBe(false);

      // 我々が作っていないエントリは残っていなければならない(follow しない lstat で確認する)。
      await expect(lstat(targetLink)).resolves.toBeDefined();
      // part も作られない。
      expect(existsSync(join(projectRoot, "parts/body"))).toBe(false);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("errors when the .val source does not exist", async () => {
    // 守る仕様: 参照先 .val が存在しなければ PART_ADD_SOURCE_NOT_FOUND を返し、何も書き込まない。
    const projectRoot = await makeProject();

    try {
      const result = await addPartToProject({
        projectPath: projectRoot,
        valPath: join(projectRoot, "missing.val"),
        name: "body",
        type: "body",
        variant: "v1"
      });

      expect(result.ok).toBe(false);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        "PART_ADD_SOURCE_NOT_FOUND"
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects a type that is not a single path segment before touching the filesystem", async () => {
    // 守る仕様: type は loomit.yml の role key かつ parts/<type>/ の segment。".." など単一 segment を逸脱する値は書き込み前に PART_ADD_SEGMENT_INVALID で弾く。
    const projectRoot = await makeProject();
    const valPath = join(projectRoot, "body.val");

    try {
      await writeFile(valPath, "body source\n", "utf8");

      const result = await addPartToProject({
        projectPath: projectRoot,
        valPath,
        name: "body",
        type: "../escape",
        variant: "v1"
      });

      expect(result.ok).toBe(false);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        "PART_ADD_SEGMENT_INVALID"
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("does not overwrite a part that is already registered", async () => {
    // 守る仕様: 既に登録済みの part は上書きせず PART_ADD_ALREADY_REGISTERED を返す。
    const projectRoot = await makeProject();
    const valPath = join(projectRoot, "body.val");

    try {
      await writeFile(valPath, "body source\n", "utf8");
      const first = await addPartToProject({
        projectPath: projectRoot,
        valPath,
        name: "body",
        type: "body",
        variant: "v1"
      });
      expect(first.ok).toBe(true);

      const second = await addPartToProject({
        projectPath: projectRoot,
        valPath,
        name: "body",
        type: "body",
        variant: "v2"
      });

      expect(second.ok).toBe(false);
      expect(second.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        "PART_ADD_ALREADY_REGISTERED"
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
