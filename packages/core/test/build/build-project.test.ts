import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildProject } from "../../src/build/buildProject.js";
import { loadProject } from "../../src/project/loadProject.js";
import { resolveParts } from "../../src/project/resolveParts.js";

describe("buildProject", () => {
  it("copies referenced part files and writes a build manifest", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-build-"));

    try {
      await writeBuildFixture(tempRoot, { includePreview: true });

      const resolvedProject = await loadResolvedProject(tempRoot);
      const result = await buildProject(resolvedProject);

      expect(result.ok).toBe(true);
      expect(result.ok ? result.value.status : "").toBe("ok");
      expect(await readFile(join(tempRoot, "output/parts/body/source/body.val"), "utf8")).toBe(
        "body source\n"
      );
      expect(await readFile(join(tempRoot, "output/parts/body/preview/body.svg"), "utf8")).toBe(
        "<svg></svg>\n"
      );

      const manifest = JSON.parse(await readFile(join(tempRoot, "output/manifest.json"), "utf8")) as {
        readonly schema: string;
        readonly project: string;
        readonly assets: readonly { readonly role: string; readonly kind: string }[];
      };

      expect(manifest.schema).toBe("loomit.build_manifest.v0");
      expect(manifest.project).toBe("build-blouse");
      expect(manifest.assets).toEqual([
        {
          role: "body",
          partName: "build-body",
          kind: "source",
          sourcePath: "parts\\body\\body.val",
          outputPath: "output\\parts\\body\\source\\body.val"
        },
        {
          role: "body",
          partName: "build-body",
          kind: "preview",
          sourcePath: "parts\\body\\body.svg",
          outputPath: "output\\parts\\body\\preview\\body.svg"
        }
      ]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("returns diagnostics when a referenced build input is missing", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-build-"));

    try {
      await writeBuildFixture(tempRoot, { includePreview: false });

      const resolvedProject = await loadResolvedProject(tempRoot);
      const result = await buildProject(resolvedProject);

      expect(result.ok).toBe(false);
      expect(result.ok ? [] : result.diagnostics).toEqual([
        {
          severity: "error",
          code: "BUILD_INPUT_FILE_MISSING",
          message: "A part file referenced for build output does not exist.",
          target: "parts\\body\\body.svg",
          suggestion: ["Add the preview file, or update part files.preview."]
        }
      ]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

async function writeBuildFixture(
  projectRoot: string,
  options: { readonly includePreview: boolean }
): Promise<void> {
  await mkdir(join(projectRoot, "parts/body"), { recursive: true });

  await writeFile(
    join(projectRoot, "loomit.yml"),
    [
      "schema: loomit.project.v0",
      "name: build-blouse",
      "garment: blouse",
      "parts:",
      "  body: ./parts/body/part.loom",
      "outputs:",
      "  dir: ./output"
    ].join("\n"),
    "utf8"
  );

  await writeFile(
    join(projectRoot, "parts/body/part.loom"),
    [
      "schema: loomit.part.v0",
      "name: build-body",
      "variant: test",
      "type: body",
      "files:",
      "  source: body.val",
      "  preview: body.svg"
    ].join("\n"),
    "utf8"
  );
  await writeFile(join(projectRoot, "parts/body/body.val"), "body source\n", "utf8");

  if (options.includePreview) {
    await writeFile(join(projectRoot, "parts/body/body.svg"), "<svg></svg>\n", "utf8");
  }
}

async function loadResolvedProject(projectRoot: string) {
  const loadedProject = await loadProject(projectRoot);

  if (!loadedProject.ok) {
    throw new Error("Expected project to load.");
  }

  const resolvedProject = await resolveParts(loadedProject.value);

  if (!resolvedProject.ok) {
    throw new Error("Expected project parts to resolve.");
  }

  return resolvedProject.value;
}
