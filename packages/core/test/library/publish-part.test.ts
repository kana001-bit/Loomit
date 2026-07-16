import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { addLibraryPartToProject } from "../../src/library/addLibraryPartToProject.js";
import { listLibraryParts } from "../../src/library/listLibraryParts.js";
import { loadLibraryMetaFile } from "../../src/library/loadLibraryMeta.js";
import { publishPart } from "../../src/library/publishPart.js";
import { createProject } from "../../src/project/createProject.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

describe("publishPart", () => {
  it("copies a part directory into the library with metadata", async () => {
    // 守る仕様: publish は part ディレクトリを library へコピーし meta.yml を書く。
    // provenance の source_part は OS 非依存の POSIX 区切り("/")で保存する。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-library-"));
    const libraryRoot = join(tempRoot, "library");

    try {
      const result = await publishPart({
        partPath: join(fixturesRoot, "valid-blouse/parts/sleeve"),
        libraryRoot,
        publishedAt: "2026-07-02T00:00:00.000Z"
      });

      expect(result.ok).toBe(true);
      expect(result.ok ? result.value.meta : undefined).toEqual({
        schema: "loomit.library_meta.v0",
        name: "basic-sleeve",
        type: "sleeve",
        source_project: join(fixturesRoot, "valid-blouse"),
        source_part: "parts/sleeve",
        published_at: "2026-07-02T00:00:00.000Z",
        status: "published"
      });
      expect(
        await readFile(join(libraryRoot, "sleeves/basic-sleeve/part.loom"), "utf8")
      ).toContain("name: basic-sleeve");

      const metaResult = await loadLibraryMetaFile(
        join(libraryRoot, "sleeves/basic-sleeve/meta.yml")
      );

      expect(metaResult.ok).toBe(true);
      expect(metaResult.ok ? metaResult.value.name : "").toBe("basic-sleeve");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects a publish name that escapes the library root", async () => {
    // 守る仕様: --name は library root 配下のディレクトリ名に限る。`..` で外へ出る名前は書き込み前に拒否する。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-library-"));
    const libraryRoot = join(tempRoot, "library");

    try {
      const result = await publishPart({
        partPath: join(fixturesRoot, "valid-blouse/parts/sleeve"),
        libraryRoot,
        name: "../../escaped"
      });

      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.diagnostics[0]?.code).toBe("LIBRARY_PART_NAME_ESCAPES_ROOT");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not overwrite an existing library entry", async () => {
    // 守る仕様: 同名の library entry が既にあれば上書きせず、LIBRARY_PART_ALREADY_EXISTS(error)で止める。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-library-"));
    const libraryRoot = join(tempRoot, "library");
    const partPath = join(fixturesRoot, "valid-blouse/parts/sleeve");

    try {
      const firstResult = await publishPart({
        partPath,
        libraryRoot
      });

      if (!firstResult.ok) {
        throw new Error("Expected first publish to succeed.");
      }

      const secondResult = await publishPart({
        partPath,
        libraryRoot
      });

      expect(secondResult.ok).toBe(false);
      expect(secondResult.ok ? [] : secondResult.diagnostics).toEqual([
        {
          severity: "error",
          code: "LIBRARY_PART_ALREADY_EXISTS",
          message: "A library part with this name already exists.",
          target: join(libraryRoot, "sleeves/basic-sleeve"),
          suggestion: ["Choose another publish name, or remove the existing library entry."]
        }
      ]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("listLibraryParts", () => {
  it("lists published library parts", async () => {
    // 守る仕様: publish 済みの part は listLibraryParts で type ごとに列挙できる。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-library-"));
    const libraryRoot = join(tempRoot, "library");

    try {
      const publishResult = await publishPart({
        partPath: join(fixturesRoot, "valid-blouse/parts/sleeve"),
        libraryRoot,
        publishedAt: "2026-07-02T00:00:00.000Z"
      });

      if (!publishResult.ok) {
        throw new Error("Expected publish to succeed.");
      }

      const listResult = await listLibraryParts({
        libraryRoot,
        type: "sleeve"
      });

      expect(listResult.ok).toBe(true);
      expect(listResult.ok ? listResult.value.map((entry) => entry.meta.name) : []).toEqual([
        "basic-sleeve"
      ]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("addLibraryPartToProject", () => {
  it("copies a library part into a project and updates loomit.yml", async () => {
    // 守る仕様: library part を project へ取り込むと part ディレクトリをコピーし、loomit.yml の role をそのパスへ更新する。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-library-"));
    const libraryRoot = join(tempRoot, "library");
    const projectRoot = join(tempRoot, "project");

    try {
      const projectResult = await createProject({
        targetPath: projectRoot,
        garment: "blouse"
      });

      if (!projectResult.ok) {
        throw new Error("Expected project to be created.");
      }

      const publishResult = await publishPart({
        partPath: join(fixturesRoot, "valid-blouse/parts/sleeve"),
        libraryRoot,
        publishedAt: "2026-07-02T00:00:00.000Z"
      });

      if (!publishResult.ok) {
        throw new Error("Expected publish to succeed.");
      }

      const addResult = await addLibraryPartToProject({
        libraryRoot,
        projectPath: projectRoot,
        type: "sleeve",
        name: "basic-sleeve"
      });

      expect(addResult.ok).toBe(true);
      expect(addResult.ok ? addResult.value.project.parts.sleeve : "").toBe(
        "./parts/sleeve/basic-sleeve/part.loom"
      );
      expect(await readFile(join(projectRoot, "parts/sleeve/basic-sleeve/part.loom"), "utf8"))
        .toContain("name: basic-sleeve");
      expect(await readFile(join(projectRoot, "loomit.yml"), "utf8")).toContain(
        "sleeve: ./parts/sleeve/basic-sleeve/part.loom"
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects a role that is not a safe path segment", async () => {
    // 守る仕様: --role/--as は loomit.yml の role key と相対パスとして保存される。segment を逸脱する値
    // (例: "nested/role")は書き込み前に拒否し、schema が読めない project file を生成させない。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-library-"));
    const libraryRoot = join(tempRoot, "library");
    const projectRoot = join(tempRoot, "project");

    try {
      const projectResult = await createProject({ targetPath: projectRoot, garment: "blouse" });

      if (!projectResult.ok) {
        throw new Error("Expected project to be created.");
      }

      const publishResult = await publishPart({
        partPath: join(fixturesRoot, "valid-blouse/parts/sleeve"),
        libraryRoot
      });

      if (!publishResult.ok) {
        throw new Error("Expected publish to succeed.");
      }

      const addResult = await addLibraryPartToProject({
        libraryRoot,
        projectPath: projectRoot,
        type: "sleeve",
        name: "basic-sleeve",
        role: "nested/role"
      });

      expect(addResult.ok).toBe(false);
      expect(addResult.ok ? "" : addResult.diagnostics[0]?.code).toBe("PROJECT_PART_SEGMENT_INVALID");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not replace an existing project role by default", async () => {
    // 守る仕様: 既存 role があるとき既定では置換せず PROJECT_PART_ROLE_ALREADY_EXISTS(error)。--replace を明示したときだけ更新する。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-library-"));
    const libraryRoot = join(tempRoot, "library");
    const projectRoot = join(tempRoot, "project");

    try {
      const projectResult = await createProject({
        targetPath: projectRoot,
        garment: "blouse"
      });

      if (!projectResult.ok) {
        throw new Error("Expected project to be created.");
      }

      const publishResult = await publishPart({
        partPath: join(fixturesRoot, "valid-blouse/parts/sleeve"),
        libraryRoot
      });

      if (!publishResult.ok) {
        throw new Error("Expected publish to succeed.");
      }

      const firstAddResult = await addLibraryPartToProject({
        libraryRoot,
        projectPath: projectRoot,
        type: "sleeve",
        name: "basic-sleeve"
      });

      if (!firstAddResult.ok) {
        throw new Error("Expected first add to succeed.");
      }

      const secondAddResult = await addLibraryPartToProject({
        libraryRoot,
        projectPath: projectRoot,
        type: "sleeve",
        name: "basic-sleeve",
        localName: "another-sleeve"
      });

      expect(secondAddResult.ok).toBe(false);
      expect(secondAddResult.ok ? [] : secondAddResult.diagnostics).toEqual([
        {
          severity: "error",
          code: "PROJECT_PART_ROLE_ALREADY_EXISTS",
          message: 'Project already has a part for role "sleeve".',
          target: "parts.sleeve",
          suggestion: ["Pass --replace to update the project role to the imported library part."]
        }
      ]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
