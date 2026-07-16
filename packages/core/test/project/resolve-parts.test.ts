import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadProject, resolveParts, resolveProjectPaths } from "../../src/index.js";
import type { LoadedProject, Project } from "../../src/index.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

describe("resolveParts", () => {
  it("loads every part referenced by a valid project", async () => {
    // 守る仕様: 妥当な project は参照している全 part を読み込み、role をキーに type と filePath を解決する。
    const projectRoot = join(fixturesRoot, "valid-blouse");
    const loadedProject = expectLoaded(await loadProject(projectRoot));
    const result = await resolveParts(loadedProject);

    expect(result.ok).toBe(true);
    expect(result.ok ? Object.keys(result.value.parts).sort() : []).toEqual(["body", "sleeve"]);
    expect(result.ok ? result.value.parts.body?.part.type : "").toBe("body");
    expect(result.ok ? result.value.parts.sleeve?.part.type : "").toBe("sleeve");
    expect(result.ok ? result.value.parts.body?.filePath : "").toBe(
      join(projectRoot, "parts/body/part.loom")
    );
  });

  it("returns diagnostics when referenced part files cannot be loaded", async () => {
    // 守る仕様: 参照先の part ファイルが読めない場合は FILE_READ_FAILED をファイルごとに返す。
    const projectRoot = join(fixturesRoot, "missing-sleeve");
    const loadedProject = expectLoaded(await loadProject(projectRoot));
    const result = await resolveParts(loadedProject);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: "error",
        code: "FILE_READ_FAILED",
        target: join(projectRoot, "parts/body/part.loom")
      }),
      expect.objectContaining({
        severity: "error",
        code: "FILE_READ_FAILED",
        target: join(projectRoot, "parts/sleeve/part.loom")
      })
    ]);
  });

  it("keeps project role and part type as separate axes", async () => {
    // 守る仕様: garment-aware add の受け皿として、part role(front/back) と part.type(body) は別軸で読める。
    const projectRoot = join(fixturesRoot, "valid-blouse");
    const project: Project = {
      schema: "loomit.project.v0",
      name: "role-type-split",
      garment: "blouse",
      parts: {
        front: "./parts/body/part.loom"
      }
    };
    const loadedProject: LoadedProject = {
      project,
      paths: resolveProjectPaths(projectRoot, project)
    };
    const result = await resolveParts(loadedProject);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value.parts.front).toEqual(
      expect.objectContaining({
        role: "front",
        part: expect.objectContaining({
          type: "body"
        })
      })
    );
  });
});

function expectLoaded<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) {
    throw new Error("Expected project to load.");
  }

  return result.value;
}
