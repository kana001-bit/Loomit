import { dirname, isAbsolute, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { findProjectRoot, loadProject, resolveProjectPaths } from "../../src/index.js";
import type { Project } from "../../src/index.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

describe("project path resolution", () => {
  it("finds the project root from a nested directory", async () => {
    // 守る仕様: findProjectRoot は入れ子ディレクトリから loomit.yml を上へ辿って project root を特定する。
    const projectRoot = join(fixturesRoot, "valid-blouse");
    const nestedDirectory = join(projectRoot, "parts/body");
    const result = await findProjectRoot(nestedDirectory);

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value : "").toBe(projectRoot);
  });

  it("finds the project root from the project file path", async () => {
    // 守る仕様: findProjectRoot は loomit.yml のファイルパスを渡してもその project root を返す。
    const projectRoot = join(fixturesRoot, "valid-blouse");
    const result = await findProjectRoot(join(projectRoot, "loomit.yml"));

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value : "").toBe(projectRoot);
  });

  it("returns a diagnostic when no project root can be found", async () => {
    // 守る仕様: loomit.yml が見つからない場所では PROJECT_ROOT_NOT_FOUND を返す。
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
    // 守る仕様: resolveProjectPaths は project root を基点に、各 part の相対パスを絶対パスへ解決する。
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
    expect(isAbsolute(paths.partFilePaths.body ?? "")).toBe(true);
  });

  it("loads a project without rewriting stored relative paths", async () => {
    // 守る仕様: load しても loomit.yml に保存された相対パス表記は書き換えず、解決結果は別途 絶対パスとして持つ。
    const projectRoot = join(fixturesRoot, "valid-blouse");
    const result = await loadProject(join(projectRoot, "parts/body"));

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.project.parts.body : "").toBe("./parts/body/part.loom");
    expect(result.ok ? result.value.paths.partFilePaths.body : "").toBe(
      join(projectRoot, "./parts/body/part.loom")
    );
  });

  it("keeps Windows-style resolved paths usable by Node path operations", async () => {
    // 守る仕様: 解決後の絶対パスは Node の path 操作(relative/normalize)でそのまま扱える(Windows 区切りでも壊れない)。
    const projectRoot = join(fixturesRoot, "valid-blouse");
    const result = await loadProject(projectRoot);

    expect(result.ok).toBe(true);

    const bodyPath = result.ok ? result.value.paths.partFilePaths.body ?? "" : "";
    const relativeBodyPath = normalize(relative(projectRoot, bodyPath));

    expect(relativeBodyPath).toBe(normalize("parts/body/part.loom"));
  });
});
