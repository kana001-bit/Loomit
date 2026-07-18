import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadProjectFile } from "../../src/index.js";
import { createProject } from "../../src/project/createProject.js";
import { forkProject } from "../../src/project/forkProject.js";

describe("forkProject", () => {
  it("copies a project, updates the project name, and keeps prototype notes", async () => {
    // 守る仕様: fork は project を複製し、project.name を fork 先の名前に更新し、prototype notes と part files は引き継ぐ。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-fork-"));
    const sourcePath = join(tempRoot, "source-blouse");
    const targetPath = join(tempRoot, "target-blouse");

    try {
      const source = await createProject({
        targetPath: sourcePath,
        garment: "blouse"
      });

      if (!source.ok) {
        throw new Error("Expected source project to be created.");
      }

      await writeFile(
        join(sourcePath, "notes/prototype-notes.yml"),
        [
          "schema: loomit.prototype_notes.v0",
          "notes:",
          "  - id: note-1",
          "    date: 2026-06-28",
          "    result: failed",
          "    issue: armhole tight when raising arms",
          "    creates_test_case: arm-raise",
          "    applies_to:",
          "      - fitted-armhole"
        ].join("\n"),
        "utf8"
      );
      await mkdir(join(sourcePath, "parts/body"));
      await writeFile(join(sourcePath, "parts/body/part.loom"), "example body file\n", "utf8");

      const result = await forkProject({
        sourcePath,
        targetPath
      });

      expect(result.ok).toBe(true);
      expect(result.ok ? result.value.project.name : "").toBe("target-blouse");

      const targetProject = await loadProjectFile(join(targetPath, "loomit.yml"));

      expect(targetProject.ok).toBe(true);
      expect(targetProject.ok ? targetProject.value.name : "").toBe("target-blouse");
      expect(await readFile(join(targetPath, "notes/prototype-notes.yml"), "utf8")).toContain(
        "creates_test_case: arm-raise"
      );
      expect(await readFile(join(targetPath, "parts/body/part.loom"), "utf8")).toBe(
        "example body file\n"
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not copy the source output directory into the fork", async () => {
    // 守る仕様: 生成物(output/)は再生成可能なので fork の対象にしない。stale/large な output を持ち込まない。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-fork-"));
    const sourcePath = join(tempRoot, "source-blouse");
    const targetPath = join(tempRoot, "target-blouse");

    try {
      const source = await createProject({ targetPath: sourcePath });

      if (!source.ok) {
        throw new Error("Expected source project to be created.");
      }

      await writeFile(join(sourcePath, "output/stale.txt"), "stale build output\n", "utf8");
      await mkdir(join(sourcePath, "parts/body"));
      await writeFile(join(sourcePath, "parts/body/part.loom"), "example body file\n", "utf8");

      const result = await forkProject({ sourcePath, targetPath });

      expect(result.ok).toBe(true);
      const targetEntries = await readdir(targetPath);
      expect(targetEntries).not.toContain("output");
      // プロジェクトの残り(永続する状態)はちゃんと fork される。
      expect(await readFile(join(targetPath, "parts/body/part.loom"), "utf8")).toBe(
        "example body file\n"
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("refuses to fork a project whose outputs.dir overlaps durable state", async () => {
    // 守る仕様: outputs.dir が durable scaffold(例: ./parts)を指す source は、fork の output 除外が
    // part files を巻き込むため、fork は成功させず schema validation で明確に失敗させる。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-fork-"));
    const sourcePath = join(tempRoot, "source-blouse");
    const targetPath = join(tempRoot, "target-blouse");

    try {
      await mkdir(join(sourcePath, "parts/body"), { recursive: true });
      await writeFile(
        join(sourcePath, "loomit.yml"),
        [
          "schema: loomit.project.v0",
          "name: source-blouse",
          "garment: blouse",
          "parts:",
          "  body: ./parts/body/part.loom",
          "outputs:",
          "  dir: ./parts"
        ].join("\n"),
        "utf8"
      );
      await writeFile(join(sourcePath, "parts/body/part.loom"), "example body file\n", "utf8");

      const result = await forkProject({ sourcePath, targetPath });

      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.diagnostics[0]?.code).toBe("PROJECT_SCHEMA_INVALID");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not overwrite an existing target path", async () => {
    // 守る仕様: fork 先が既に存在する場合は上書きせず PROJECT_ALREADY_EXISTS を返す。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-fork-"));
    const sourcePath = join(tempRoot, "source-blouse");
    const targetPath = join(tempRoot, "target-blouse");

    try {
      const source = await createProject({
        targetPath: sourcePath
      });

      if (!source.ok) {
        throw new Error("Expected source project to be created.");
      }

      await mkdir(targetPath);

      const result = await forkProject({
        sourcePath,
        targetPath
      });

      expect(result).toEqual({
        ok: false,
        diagnostics: [
          {
            severity: "error",
            code: "PROJECT_ALREADY_EXISTS",
            message:
              "fork 先のパスはすでに存在します。/ The fork target path already exists.",
            target: targetPath,
            suggestion: ["Choose a new directory, or remove the existing one before forking."]
          }
        ]
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects targets inside the source project", async () => {
    // 守る仕様: fork 先を fork 元の内側に置くのは PROJECT_FORK_TARGET_INSIDE_SOURCE で拒否する(自己参照コピーを防ぐ)。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-fork-"));
    const sourcePath = join(tempRoot, "source-blouse");

    try {
      const source = await createProject({
        targetPath: sourcePath
      });

      if (!source.ok) {
        throw new Error("Expected source project to be created.");
      }

      const targetPath = join(sourcePath, "forked-inside-source");
      const result = await forkProject({
        sourcePath,
        targetPath
      });

      expect(result).toEqual({
        ok: false,
        diagnostics: [
          {
            severity: "error",
            code: "PROJECT_FORK_TARGET_INSIDE_SOURCE",
            message:
              "fork 先を fork 元プロジェクトの内側には作成できません。/ The fork target cannot be inside the source project.",
            target: targetPath,
            suggestion: ["Choose a target directory outside the source project."]
          }
        ]
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
