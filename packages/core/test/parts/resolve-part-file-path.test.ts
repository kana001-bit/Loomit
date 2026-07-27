import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { resolvePartFilePath } from "../../src/index.js";

// project root / parts/body/part.loom という最小構成を作る。どのファイルを実在させるかは呼び手が決める。
async function makeProject(): Promise<{
  readonly projectRoot: string;
  readonly partFilePath: string;
}> {
  const projectRoot = await mkdtemp(join(tmpdir(), "loomit-resolve-part-file-"));
  await mkdir(join(projectRoot, "parts/body"), { recursive: true });

  return { projectRoot, partFilePath: join(projectRoot, "parts/body/part.loom") };
}

describe("resolvePartFilePath", () => {
  it("prefers the project root file when it exists", async () => {
    // 守る仕様: root に同名ファイルが実在すればそれを返す。root のファイルが原本(loom add のコピー元)
    // なので、コピーを持つ既存プロジェクトも移行作業なしで原本を読むようになる。
    const { projectRoot, partFilePath } = await makeProject();

    try {
      await writeFile(join(projectRoot, "body.val"), "original\n", "utf8");
      await writeFile(join(projectRoot, "parts/body/body.val"), "stale copy\n", "utf8");

      expect(resolvePartFilePath({ projectRoot, partFilePath, value: "body.val" })).toBe(
        join(projectRoot, "body.val")
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("falls back to the part directory when the project root has no such file", async () => {
    // 守る仕様: root に無ければ part 相対に落ちる。これが既存プロジェクト(コピーしか無い状態)の
    // 後方互換パスで、resolver 導入だけでは挙動が変わらないことを保証する。
    const { projectRoot, partFilePath } = await makeProject();

    try {
      await writeFile(join(projectRoot, "parts/body/body.val"), "only the copy\n", "utf8");

      expect(resolvePartFilePath({ projectRoot, partFilePath, value: "body.val" })).toBe(
        join(projectRoot, "parts/body/body.val")
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("returns the part-relative path when neither file exists", async () => {
    // 守る仕様: どちらも実在しなければ part 相対を返す。呼び手はこのパスを ENOENT 診断の target に
    // 使うため、既存プロジェクトで従来と同じ場所を指し続ける必要がある。
    const { projectRoot, partFilePath } = await makeProject();

    try {
      expect(resolvePartFilePath({ projectRoot, partFilePath, value: "missing.val" })).toBe(
        join(projectRoot, "parts/body/missing.val")
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("resolves part-relative only when the project root is unknown", async () => {
    // 守る仕様: projectRoot が undefined(project を読まない経路。loom diff のパス指定モード等)では
    // root を探しに行かず part 相対だけで解決する。root 探索の判断は呼び手の責務。
    const { projectRoot, partFilePath } = await makeProject();

    try {
      // root にファイルが在っても、projectRoot を渡さなければ採用されない。
      await writeFile(join(projectRoot, "body.val"), "original\n", "utf8");

      expect(resolvePartFilePath({ partFilePath, value: "body.val" })).toBe(
        join(projectRoot, "parts/body/body.val")
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("does not take a root candidate that escapes the project root", async () => {
    // 守る仕様: root 候補が project root の外へ出る場合は採用しない(R2 境界検証)。schema の
    // relativePathSchema が ".." を拒否済みなので通常は到達しないが、schema を経由しない呼び手から
    // root 外のファイルを読ませない。
    const { projectRoot, partFilePath } = await makeProject();

    try {
      // root 候補 <projectRoot>/../escaped.val は root 外なので捨て、part 相対に落ちる。
      expect(resolvePartFilePath({ projectRoot, partFilePath, value: "../escaped.val" })).toBe(
        join(projectRoot, "parts/escaped.val")
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
