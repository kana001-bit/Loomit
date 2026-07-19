import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  findUnregisteredValSources,
  isCaseInsensitiveFileSystemAt,
  loadProject,
  resolveParts
} from "../../src/index.js";
import type { UnregisteredValSource } from "../../src/index.js";

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

// ok を期待するテスト用に scan 結果を unwrap する(失敗したらテストごと落とす)。
async function scanOk(
  projectRoot: string,
  options?: { readonly includeProjectRoot?: boolean }
): Promise<readonly UnregisteredValSource[]> {
  const scan = await findUnregisteredValSources(await resolve(projectRoot), options);

  if (!scan.ok) {
    throw new Error(`Expected the scan to succeed: ${JSON.stringify(scan.diagnostics)}`);
  }

  return scan.value;
}

async function writeProject(projectRoot: string, partsBlock: string): Promise<void> {
  await writeFile(
    join(projectRoot, "loomit.yml"),
    ["schema: loomit.project.v0", "name: find-vals", "garment: blouse", partsBlock].join("\n"),
    "utf8"
  );
}

async function writeBodyPart(projectRoot: string, source = "body.val"): Promise<void> {
  await mkdir(join(projectRoot, "parts/body"), { recursive: true });
  await writeFile(
    join(projectRoot, "parts/body/part.loom"),
    [
      "schema: loomit.part.v0",
      "name: body",
      "variant: v1",
      "type: body",
      "files:",
      `  source: ${source}`
    ].join("\n"),
    "utf8"
  );
}

describe("findUnregisteredValSources", () => {
  it("returns unregistered .val files under parts/ sorted by relative path, excluding registered sources", async () => {
    // 守る仕様: parts/ 配下(再帰)の .val のうち、どの part の files.source でもないものだけを
    // 相対パス昇順で返す(check の UNREGISTERED_VAL_SOURCE と loom add の自動発見が共有する定義)。
    const projectRoot = await mkdtemp(join(tmpdir(), "loomit-find-vals-"));

    try {
      await writeProject(projectRoot, "parts:\n  body: ./parts/body/part.loom");
      await writeBodyPart(projectRoot);
      await writeFile(join(projectRoot, "parts/body/body.val"), "body source\n", "utf8");
      await writeFile(join(projectRoot, "parts/zeta.val"), "zeta\n", "utf8");
      await writeFile(join(projectRoot, "parts/alpha.val"), "alpha\n", "utf8");

      const sources = await scanOk(projectRoot);

      // 登録済みの parts/body/body.val は含まれず、未登録2件が相対パス昇順で返る。
      expect(sources.map((source) => source.relativePath)).toEqual([
        "parts/alpha.val",
        "parts/zeta.val"
      ]);
      expect(sources.every((source) => source.duplicateOf === undefined)).toBe(true);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("includes project-root .val files only when includeProjectRoot is set", async () => {
    // 守る仕様: root 直下(非再帰)の .val は includeProjectRoot 指定時だけ候補に入る(loom add の
    // 自動発見用)。既定=check の走査は従来どおり parts/ のみで、root の原本を常時警告にしない。
    const projectRoot = await mkdtemp(join(tmpdir(), "loomit-find-root-"));

    try {
      await writeProject(projectRoot, "parts: {}");
      await writeFile(join(projectRoot, "knickers.val"), "<pattern></pattern>\n", "utf8");

      expect(await scanOk(projectRoot)).toEqual([]);

      const withRoot = await scanOk(projectRoot, { includeProjectRoot: true });
      expect(withRoot.map((source) => source.relativePath)).toEqual(["knickers.val"]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("marks a candidate that duplicates a registered source with duplicateOf", async () => {
    // 守る仕様: 登録済み source と同一内容の候補には duplicateOf(登録済み側の相対パス)が付く。
    // loom add の自動発見はこれを取り込まず、check は「削除」を促す(残骸の再 add を防ぐ)。
    const projectRoot = await mkdtemp(join(tmpdir(), "loomit-find-dup-"));

    try {
      await writeProject(projectRoot, "parts:\n  body: ./parts/body/part.loom");
      await writeBodyPart(projectRoot);
      await writeFile(join(projectRoot, "parts/body/body.val"), "body source\n", "utf8");
      // 登録済み parts/body/body.val と同一内容の残骸を root 直下に置く(明示パス add の取り残し)。
      await writeFile(join(projectRoot, "body.val"), "body source\n", "utf8");

      const sources = await scanOk(projectRoot, { includeProjectRoot: true });

      expect(sources).toHaveLength(1);
      expect(sources[0]?.relativePath).toBe("body.val");
      expect(sources[0]?.duplicateOf).toBe("parts/body/body.val");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("fails with a scan diagnostic instead of pretending there are no candidates", async () => {
    // 守る仕様: ディレクトリ走査の失敗(ENOENT 以外。ここでは parts がディレクトリでなくファイル)を
    // 空扱いに畳まない。「.val が無い」と偽ると権限エラー等が空プロジェクトに見えるため、ok:false と
    // errno 分類済みの診断で返す(ENOENT=parts/ が無い だけが正常な不在)。
    const projectRoot = await mkdtemp(join(tmpdir(), "loomit-find-scanfail-"));

    try {
      await writeProject(projectRoot, "parts: {}");
      // parts をディレクトリでなくファイルにして readdir を失敗させる(ENOTDIR 系・移植可能な失敗注入)。
      await writeFile(join(projectRoot, "parts"), "not a directory\n", "utf8");

      const scan = await findUnregisteredValSources(await resolve(projectRoot));

      expect(scan.ok).toBe(false);
      expect(scan.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        "VAL_SOURCE_SCAN_FAILED"
      ]);
      expect(scan.diagnostics[0]?.severity).toBe("error");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("degrades an unreadable registered source to a warning and keeps the candidate", async () => {
    // 守る仕様: 個別ファイルの内容読み失敗(ENOENT 以外。ここでは files.source がディレクトリ)は走査を
    // 落とさず warning に降格し、そのファイルの残骸判定だけを省略する(候補は duplicateOf なしで残る)。
    // 握り潰さない: 何を証明できなかったかを diagnostics で見せる。
    const projectRoot = await mkdtemp(join(tmpdir(), "loomit-find-readfail-"));

    try {
      await writeProject(projectRoot, "parts:\n  body: ./parts/body/part.loom");
      // files.source がディレクトリを指す壊れた part(readFile が EISDIR 系で失敗する)。
      await writeBodyPart(projectRoot, "srcdir");
      await mkdir(join(projectRoot, "parts/body/srcdir"));
      await writeFile(join(projectRoot, "parts/stray.val"), "stray\n", "utf8");

      const scan = await findUnregisteredValSources(await resolve(projectRoot));

      expect(scan.ok).toBe(true);

      if (scan.ok) {
        expect(scan.value.map((source) => source.relativePath)).toEqual(["parts/stray.val"]);
        expect(scan.value[0]?.duplicateOf).toBeUndefined();
      }

      expect(scan.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        "VAL_SOURCE_READ_FAILED"
      ]);
      expect(scan.diagnostics[0]?.severity).toBe("warning");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("matches registered sources with the real filesystem's case sensitivity", async () => {
    // 守る仕様: 登録済み判定は実 FS の case 感度に従う。insensitive な FS(Windows/macOS 既定)では
    // 大小違いの files.source 参照を登録済みと同一視し(誤って候補に出さない)、sensitive な FS
    // (Linux 等)では別ファイルとして候補に出す(小文字化固定だと永遠に発見されない)。
    const projectRoot = await mkdtemp(join(tmpdir(), "loomit-find-case-"));

    try {
      await writeProject(projectRoot, "parts:\n  body: ./parts/body/part.loom");
      // part は小文字 body.val を参照するが、実ファイルは大文字 BODY.val だけを置く。
      await writeBodyPart(projectRoot, "body.val");
      await writeFile(join(projectRoot, "parts/body/BODY.val"), "body source\n", "utf8");

      const caseInsensitive = await isCaseInsensitiveFileSystemAt(join(projectRoot, "loomit.yml"));
      const sources = await scanOk(projectRoot);

      if (caseInsensitive) {
        // 大小違いは同じファイル(登録済み)なので候補にしない。
        expect(sources).toEqual([]);
      } else {
        // 別ファイルなので未登録の候補として見える(参照先 body.val は存在しない)。
        expect(sources.map((source) => source.relativePath)).toEqual(["parts/body/BODY.val"]);
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
