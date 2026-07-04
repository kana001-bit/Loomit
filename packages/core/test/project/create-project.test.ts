import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadProjectFile } from "../../src/index.js";
import { createProject } from "../../src/project/createProject.js";

describe("createProject", () => {
  it("creates a schema-valid empty project scaffold", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-create-"));
    const targetPath = join(tempRoot, "my-blouse");

    try {
      const result = await createProject({
        targetPath,
        garment: "blouse"
      });

      expect(result.ok).toBe(true);
      expect(result.ok ? result.value.project.name : "").toBe("my-blouse");
      expect(result.ok ? result.value.project.garment : "").toBe("blouse");
      expect((await readdir(targetPath)).sort()).toEqual([
        "loomit.yml",
        "notes",
        "output",
        "parts",
        "profiles"
      ]);

      const loadedProject = await loadProjectFile(join(targetPath, "loomit.yml"));

      expect(loadedProject.ok).toBe(true);
      expect(loadedProject.ok ? loadedProject.value : undefined).toEqual({
        schema: "loomit.project.v0",
        name: "my-blouse",
        garment: "blouse",
        parts: {},
        profiles: {},
        outputs: {
          dir: "./output"
        }
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("initializes an existing empty target directory", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-create-"));

    try {
      const result = await createProject({
        targetPath: tempRoot
      });

      expect(result.ok).toBe(true);
      expect((await readdir(tempRoot)).sort()).toEqual([
        "loomit.yml",
        "notes",
        "output",
        "parts",
        "profiles"
      ]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps pre-existing directories when scaffold creation fails partway", async () => {
    // 守る仕様: init は既存ディレクトリ内で走る。scaffold 作成が途中で失敗しても、この呼び出しが
    // 作っていない既存ディレクトリ(と中身)を rollback で削除しない。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-create-"));

    try {
      await mkdir(join(tempRoot, "notes"));
      await writeFile(join(tempRoot, "notes/keep.txt"), "keep me\n", "utf8");
      // profiles をファイルとして置くと mkdir(profiles) が失敗し、scaffold 作成が途中で止まる。
      await writeFile(join(tempRoot, "profiles"), "not a directory\n", "utf8");

      const result = await createProject({ targetPath: tempRoot });

      expect(result.ok).toBe(false);
      // この呼び出しが作っていない既存 notes と中身はそのまま残る。
      expect(await readdir(join(tempRoot, "notes"))).toContain("keep.txt");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not overwrite an existing loomit.yml", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-create-"));
    const projectFilePath = join(tempRoot, "loomit.yml");

    try {
      await writeFile(projectFilePath, "existing project\n", "utf8");

      const result = await createProject({
        targetPath: tempRoot
      });

      expect(result).toEqual({
        ok: false,
        diagnostics: [
          {
            severity: "error",
            code: "PROJECT_ALREADY_EXISTS",
            message:
              "この場所はすでに Loomit プロジェクトです。/ This location is already a Loomit project.",
            target: projectFilePath,
            suggestion: [
              "Run this in a directory without a loomit.yml, or remove the existing project file."
            ]
          }
        ]
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
