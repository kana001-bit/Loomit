import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildProject } from "../../src/build/buildProject.js";
import { loadProject } from "../../src/project/loadProject.js";
import { resolveParts } from "../../src/project/resolveParts.js";
import type { ResolvedProject } from "../../src/index.js";

describe("buildProject", () => {
  it("copies referenced part files and writes a build manifest", async () => {
    // 守る仕様: build は参照 part ファイルを output/ にコピーし、manifest.json を書き出す。
    // manifest に載る相対パスは OS 非依存の POSIX 区切り("/")にする(Windows でも "/" になる)。
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
      expect(await readFile(join(tempRoot, "output/parts/body/geometry/body.dxf"), "utf8")).toBe(
        "0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n"
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
          sourcePath: "parts/body/body.val",
          outputPath: "output/parts/body/source/body.val"
        },
        {
          role: "body",
          partName: "build-body",
          kind: "preview",
          sourcePath: "parts/body/body.svg",
          outputPath: "output/parts/body/preview/body.svg"
        },
        {
          role: "body",
          partName: "build-body",
          kind: "geometry",
          sourcePath: "parts/body/body.dxf",
          outputPath: "output/parts/body/geometry/body.dxf"
        }
      ]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects an output directory that escapes the project root", async () => {
    // 守る仕様: outputs.dir が project root の外を指す場合、build は書き込みせず diagnostic を返す。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-build-"));

    try {
      await writeBuildFixture(tempRoot, { includePreview: true });

      const resolvedProject = await loadResolvedProject(tempRoot);
      const escaped = {
        ...resolvedProject,
        project: {
          ...resolvedProject.project,
          outputs: { dir: "../escaped-output" }
        }
      };
      const result = await buildProject(escaped);

      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.diagnostics[0]?.code).toBe("BUILD_OUTPUT_ESCAPES_ROOT");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("refuses to read a source file outside the project root", async () => {
    // 守る仕様: hand-built ResolvedProject を含め、build は project root の外にある source を読まない。
    // 境界は project root。files.* は root 相対でも part 相対でも解決されうる(resolvePartFilePath)ため、
    // 「part ディレクトリ配下」で見ると root 直下に置いた正当な原本まで拒否してしまう。
    //
    // NOTE: 以前この位置には「part ディレクトリの外なら project 内でも拒否」(BUILD_INPUT_ESCAPES_PART)の
    // テストがあった。files.* を root 相対で解決するようにした時点でその制約が成り立たなくなったため、
    // 境界を project root に緩めて差し替えた。守っている安全性(build が project 外を読まない)は同じ。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-build-"));

    try {
      const resolved = makeResolvedProject(tempRoot, {
        body: {
          role: "body",
          filePath: join(tempRoot, "parts/body/part.loom"),
          part: {
            schema: "loomit.part.v0",
            name: "build-body",
            variant: "test",
            type: "body",
            // parts/body/ から3つ上がると project root の外に出る。
            files: { source: "../../../outside.yml" }
          }
        }
      });
      const result = await buildProject(resolved);

      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.diagnostics[0]?.code).toBe("BUILD_INPUT_ESCAPES_PROJECT");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("refuses to write an output path outside the output directory", async () => {
    // 守る仕様: role が path segment を逸脱した場合(join(outputDir, "parts", role, ...) が外へ出る)、
    // build は書き込まず diagnostic を返す。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-build-"));

    try {
      const resolved = makeResolvedProject(tempRoot, {
        "../../evil": {
          role: "../../evil",
          filePath: join(tempRoot, "parts/body/part.loom"),
          part: {
            schema: "loomit.part.v0",
            name: "build-body",
            variant: "test",
            type: "body",
            files: { source: "body.val" }
          }
        }
      });
      const result = await buildProject(resolved);

      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.diagnostics[0]?.code).toBe("BUILD_OUTPUT_PATH_ESCAPES_ROOT");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("returns diagnostics when a referenced build input is missing", async () => {
    // 守る仕様: files.* が指すファイルが存在しない場合、build は書き込まず diagnostic を返す。
    // diagnostic の target も OS 非依存の POSIX 区切りにする。
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
          message: "ビルド出力が参照する part ファイルが存在しません。 / A part file referenced for build output does not exist.",
          target: "parts/body/body.svg",
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
      "  preview: body.svg",
      "  geometry: body.dxf"
    ].join("\n"),
    "utf8"
  );
  await writeFile(join(projectRoot, "parts/body/body.val"), "body source\n", "utf8");
  await writeFile(
    join(projectRoot, "parts/body/body.dxf"),
    "0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n",
    "utf8"
  );

  if (options.includePreview) {
    await writeFile(join(projectRoot, "parts/body/body.svg"), "<svg></svg>\n", "utf8");
  }
}

function makeResolvedProject(
  projectRoot: string,
  parts: ResolvedProject["parts"]
): ResolvedProject {
  return {
    project: {
      schema: "loomit.project.v0",
      name: "build-blouse",
      garment: "blouse",
      parts: {}
    },
    paths: {
      projectRoot,
      projectFilePath: join(projectRoot, "loomit.yml"),
      partFilePaths: {}
    },
    parts
  };
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
