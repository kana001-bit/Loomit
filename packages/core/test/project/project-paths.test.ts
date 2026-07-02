import { dirname, isAbsolute, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { findProjectRoot, loadProject, resolveProjectPaths } from "../../src/index.js";
import type { Project } from "../../src/index.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

describe("project path resolution", () => {
  it("finds the project root from a nested directory", async () => {
    const projectRoot = join(fixturesRoot, "valid-blouse");
    const nestedDirectory = join(projectRoot, "parts/body");
    const result = await findProjectRoot(nestedDirectory);

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value : "").toBe(projectRoot);
  });

  it("finds the project root from the project file path", async () => {
    const projectRoot = join(fixturesRoot, "valid-blouse");
    const result = await findProjectRoot(join(projectRoot, "loomit.yml"));

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value : "").toBe(projectRoot);
  });

  it("returns a diagnostic when no project root can be found", async () => {
    const startPath = join(fixturesRoot, "not-a-loomit-project");
    const result = await findProjectRoot(startPath);

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: "error",
          code: "PROJECT_ROOT_NOT_FOUND",
          message: "loomit.yml が見つかりませんでした。/ Could not find loomit.yml.",
          target: startPath,
          suggestion: [
            "Loomit プロジェクト内で実行するか、loomit.yml の場所を確認してください。/ Run inside a Loomit project or check where loomit.yml is located."
          ]
        }
      ]
    });
  });

  it("resolves project part paths from the project root", () => {
    const projectRoot = join(fixturesRoot, "valid-blouse");
    const project: Project = {
      schema: "loomit.project.v0",
      name: "valid-blouse",
      garment: "blouse",
      parts: {
        body: "./parts/body/part.loom",
        sleeve: "./parts/sleeve/part.loom"
      }
    };

    const paths = resolveProjectPaths(projectRoot, project);

    expect(paths.projectRoot).toBe(projectRoot);
    expect(paths.partFilePaths.body).toBe(join(projectRoot, "./parts/body/part.loom"));
    expect(paths.partFilePaths.sleeve).toBe(join(projectRoot, "./parts/sleeve/part.loom"));
    expect(isAbsolute(paths.partFilePaths.body)).toBe(true);
  });

  it("loads a project without rewriting stored relative paths", async () => {
    const projectRoot = join(fixturesRoot, "valid-blouse");
    const result = await loadProject(join(projectRoot, "parts/body"));

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.project.parts.body : "").toBe("./parts/body/part.loom");
    expect(result.ok ? result.value.paths.partFilePaths.body : "").toBe(
      join(projectRoot, "./parts/body/part.loom")
    );
  });

  it("keeps Windows-style resolved paths usable by Node path operations", async () => {
    const projectRoot = join(fixturesRoot, "valid-blouse");
    const result = await loadProject(projectRoot);

    expect(result.ok).toBe(true);

    const bodyPath = result.ok ? result.value.paths.partFilePaths.body : "";
    const relativeBodyPath = normalize(relative(projectRoot, bodyPath));

    expect(relativeBodyPath).toBe(normalize("parts/body/part.loom"));
  });
});
