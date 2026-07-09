import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  it("generates part.loom, copies the .val, and registers the part", async () => {
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

      // .val は part ディレクトリへコピーされ、元ファイルは残る。
      expect(await readFile(join(projectRoot, "parts/body/body.val"), "utf8")).toBe("body source\n");
      expect(await readFile(valPath, "utf8")).toBe("body source\n");

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
    // loom add は幾何の測定値を手打ちさせず、値は後で Valentina / truer が埋める前提。
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
      expect(await readFile(join(projectRoot, "parts/front/front.val"), "utf8")).toBe(
        "front source\n"
      );
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

  it("consumes a .val that already lives inside parts/ (no leftover for check to flag)", async () => {
    // parts/ 内に置いた生 .val は、取り込み後に元を削除する(= 実質 move)。コピーのままだと
    // parts/waist.val と parts/body/waist.val の二重になり、check が「未登録の .val」と咎めてしまう。
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

      // 正本は part ディレクトリへ移り、parts/ 直下の元ファイルは消える。
      expect(await readFile(join(projectRoot, "parts/body/waist.val"), "utf8")).toBe(
        "waist source\n"
      );
      await expect(readFile(valPath, "utf8")).rejects.toThrow();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("errors when the .val source does not exist", async () => {
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
    // type は loomit.yml の role key かつ parts/<type>/ の segment。".." は project root の外を指すため弾く。
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
