import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadProject, resolveParts, resolveProjectPaths } from "../../src/index.js";
import type { LoadedProject, Project } from "../../src/index.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

describe("resolveParts", () => {
  it("loads every part referenced by a valid project", async () => {
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

  it("reports a diagnostic when a project role points to a different part type", async () => {
    const projectRoot = join(fixturesRoot, "valid-blouse");
    const project: Project = {
      schema: "loomit.project.v0",
      name: "role-type-mismatch",
      garment: "blouse",
      parts: {
        sleeve: "./parts/body/part.loom"
      }
    };
    const loadedProject: LoadedProject = {
      project,
      paths: resolveProjectPaths(projectRoot, project)
    };
    const result = await resolveParts(loadedProject);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual({
      severity: "error",
      code: "PART_ROLE_TYPE_MISMATCH",
      message: 'Project part role "sleeve" points to a part with type "body".',
      target: "parts.sleeve",
      suggestion: ['Use a part with type "sleeve", or change the project role.']
    });
  });
});

function expectLoaded<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) {
    throw new Error("Expected project to load.");
  }

  return result.value;
}
