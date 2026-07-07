import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
