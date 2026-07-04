import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { writeFileAtomic } from "../../src/index.js";

describe("writeFileAtomic", () => {
  it("writes the file contents", async () => {
    // 守る仕様: writeFileAtomic は指定した内容をそのままファイルに書き込む。
    const dir = await mkdtemp(join(tmpdir(), "loomit-atomic-"));

    try {
      const target = join(dir, "loomit.yml");
      await writeFileAtomic(target, "name: my-blouse\n");

      expect(await readFile(target, "utf8")).toBe("name: my-blouse\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("leaves no temp file behind and overwrites an existing file", async () => {
    // 守る仕様: temp -> rename の書き込みは、成功後に一時ファイルを残さず、既存ファイルを置き換える。
    const dir = await mkdtemp(join(tmpdir(), "loomit-atomic-"));

    try {
      const target = join(dir, "loomit.yml");
      await writeFile(target, "old\n", "utf8");
      await writeFileAtomic(target, "new\n");

      expect(await readFile(target, "utf8")).toBe("new\n");
      expect(await readdir(dir)).toEqual(["loomit.yml"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
