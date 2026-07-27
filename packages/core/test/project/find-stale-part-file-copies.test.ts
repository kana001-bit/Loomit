import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { findStalePartFileCopies, loadProject, resolveParts } from "../../src/index.js";

async function resolve(projectRoot: string) {
  const loaded = await loadProject(projectRoot);

  if (!loaded.ok) {
    throw new Error("Expected project to load.");
  }

  const resolved = await resolveParts(loaded.value);

  if (!resolved.ok) {
    throw new Error("Expected project parts to resolve.");
  }

  return resolved.value;
}

async function writeProject(projectRoot: string): Promise<void> {
  await writeFile(
    join(projectRoot, "loomit.yml"),
    [
      "schema: loomit.project.v0",
      "name: stale-copies",
      "garment: blouse",
      "parts:",
      "  body: ./parts/body/part.loom"
    ].join("\n"),
    "utf8"
  );
}

// files ブロックを差し替えられる body part。part 側のコピーは呼び手が別途書く。
async function writeBodyPart(projectRoot: string, filesLines: readonly string[]): Promise<void> {
  await mkdir(join(projectRoot, "parts/body"), { recursive: true });
  await writeFile(
    join(projectRoot, "parts/body/part.loom"),
    [
      "schema: loomit.part.v0",
      "name: body",
      "variant: v1",
      "type: body",
      "files:",
      ...filesLines
    ].join("\n"),
    "utf8"
  );
}

describe("findStalePartFileCopies", () => {
  it("reports a part copy whose contents differ from the same-named file at the project root", async () => {
    // 守る仕様: part 内の files.source が project root の同名ファイルと内容不一致なら stale として返す
    // (loom add のコピー後に root の原本だけ編集された状態を検出する)。
    const projectRoot = await mkdtemp(join(tmpdir(), "loomit-stale-diff-"));

    try {
      await writeProject(projectRoot);
      await writeBodyPart(projectRoot, ["  source: body.val"]);
      // root の原本は編集済み、part 側のコピーは古いまま。
      await writeFile(join(projectRoot, "body.val"), "edited in Valentina\n", "utf8");
      await writeFile(join(projectRoot, "parts/body/body.val"), "old copy\n", "utf8");

      const scan = await findStalePartFileCopies(await resolve(projectRoot));

      expect(scan.diagnostics).toEqual([]);
      expect(scan.value).toHaveLength(1);
      expect(scan.value[0]?.role).toBe("body");
      expect(scan.value[0]?.field).toBe("source");
      expect(scan.value[0]?.copyRelativePath).toBe("parts/body/body.val");
      expect(scan.value[0]?.originRelativePath).toBe("body.val");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("does not report a part copy that still matches the project root original", async () => {
    // 守る仕様: 内容が一致しているコピーは stale にしない(コピー配置そのものは正常な状態なので、
    // 同名ファイルが在るというだけで警告してはならない)。
    const projectRoot = await mkdtemp(join(tmpdir(), "loomit-stale-same-"));

    try {
      await writeProject(projectRoot);
      await writeBodyPart(projectRoot, ["  source: body.val"]);
      await writeFile(join(projectRoot, "body.val"), "same bytes\n", "utf8");
      await writeFile(join(projectRoot, "parts/body/body.val"), "same bytes\n", "utf8");

      const scan = await findStalePartFileCopies(await resolve(projectRoot));

      expect(scan.value).toEqual([]);
      expect(scan.diagnostics).toEqual([]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("does not report anything when the project root has no same-named original", async () => {
    // 守る仕様: root に同名ファイルが無いのは正当な取り込み方(loom add <他ディレクトリ>/x.val)なので、
    // 比較対象なしとして黙って何も出さない。乖離の証拠が無い状態を乖離と言わない。
    const projectRoot = await mkdtemp(join(tmpdir(), "loomit-stale-no-origin-"));

    try {
      await writeProject(projectRoot);
      await writeBodyPart(projectRoot, ["  source: body.val"]);
      await writeFile(join(projectRoot, "parts/body/body.val"), "only the copy\n", "utf8");

      const scan = await findStalePartFileCopies(await resolve(projectRoot));

      expect(scan.value).toEqual([]);
      expect(scan.diagnostics).toEqual([]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("checks files.geometry as well as files.source", async () => {
    // 守る仕様: 検出は .val 専用ではない。手コピー運用の DXF(files.geometry)も同じ規則で比較する
    // (古い DXF は Seamlint に古い幾何を測らせるため、source と同じ種類の事故になる)。
    const projectRoot = await mkdtemp(join(tmpdir(), "loomit-stale-geometry-"));

    try {
      await writeProject(projectRoot);
      await writeBodyPart(projectRoot, ["  source: body.val", "  geometry: body.dxf"]);
      // source は一致、geometry だけ食い違う。
      await writeFile(join(projectRoot, "body.val"), "same bytes\n", "utf8");
      await writeFile(join(projectRoot, "parts/body/body.val"), "same bytes\n", "utf8");
      await writeFile(join(projectRoot, "body.dxf"), "re-exported\n", "utf8");
      await writeFile(join(projectRoot, "parts/body/body.dxf"), "stale export\n", "utf8");

      const scan = await findStalePartFileCopies(await resolve(projectRoot));

      expect(scan.value).toHaveLength(1);
      expect(scan.value[0]?.field).toBe("geometry");
      expect(scan.value[0]?.copyRelativePath).toBe("parts/body/body.dxf");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("warns and skips the comparison when a file cannot be read, instead of claiming it is in sync", async () => {
    // 守る仕様: ENOENT 以外の読み失敗(ここでは原本がディレクトリ)は warning に降格して比較を省略する。
    // 読めなかったものを黙って一致扱いにすると、権限エラーが「問題なし」に化けて検出が嘘になる。
    const projectRoot = await mkdtemp(join(tmpdir(), "loomit-stale-unreadable-"));

    try {
      await writeProject(projectRoot);
      await writeBodyPart(projectRoot, ["  source: body.val"]);
      await writeFile(join(projectRoot, "parts/body/body.val"), "the copy\n", "utf8");
      // root 側の "原本" がディレクトリ = readFile が EISDIR 系で失敗する。
      await mkdir(join(projectRoot, "body.val"), { recursive: true });

      const scan = await findStalePartFileCopies(await resolve(projectRoot));

      expect(scan.value).toEqual([]);
      expect(scan.diagnostics).toHaveLength(1);
      expect(scan.diagnostics[0]?.code).toBe("PART_FILE_COMPARE_READ_FAILED");
      expect(scan.diagnostics[0]?.severity).toBe("warning");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
