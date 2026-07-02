import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadProjectFile } from "../../src/index.js";
import { createProject } from "../../src/project/createProject.js";
import { forkProject } from "../../src/project/forkProject.js";

describe("forkProject", () => {
  it("copies a project, updates the project name, and keeps prototype notes", async () => {
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

  it("does not overwrite an existing target path", async () => {
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
