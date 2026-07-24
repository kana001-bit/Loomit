import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { checkPathExistence, classifyAccessError } from "../../src/index.js";

// `any` を使わずに、Node 流の errno ラベルを持たせた Error を組み立てる(fs-error.test と同じ流儀)。
function fsError(code: string): Error {
  const error = new Error(code);
  Object.assign(error, { code });
  return error;
}

describe("classifyAccessError", () => {
  it("treats ENOENT and ENOTDIR as missing", () => {
    // 守る仕様: 「そのパスにファイルが無い」を意味する errno(ENOENT/ENOTDIR)だけを missing とみなす。
    expect(classifyAccessError(fsError("ENOENT"))).toEqual({ kind: "missing" });
    expect(classifyAccessError(fsError("ENOTDIR"))).toEqual({ kind: "missing" });
  });

  it("treats permission and other errno as inaccessible and keeps the error", () => {
    // 守る仕様: EACCES/EPERM 等は存在の有無を判定できないので missing に潰さず inaccessible とし、
    // errno 分類つき Diagnostic を出せるよう元の error を保持する(R3: 原因を捨てない)。
    const permissionError = fsError("EACCES");
    const result = classifyAccessError(permissionError);

    expect(result.kind).toBe("inaccessible");
    expect(result.kind === "inaccessible" ? result.error : undefined).toBe(permissionError);
  });

  it("treats an error with no errno as inaccessible (does not guess missing)", () => {
    // 守る仕様: errno を取り出せない未知の失敗を「無い」と決めつけない(誤って空扱い/上書きしない)。
    const result = classifyAccessError(new Error("boom"));
    expect(result.kind).toBe("inaccessible");
  });
});

describe("checkPathExistence", () => {
  it("returns exists for a real file and missing for an absent path", async () => {
    // 守る仕様: 実在するパスは exists、存在しないパスは missing を返す(通常経路)。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-path-exists-"));

    try {
      const present = join(tempRoot, "present.txt");
      await writeFile(present, "hi\n", "utf8");

      expect(await checkPathExistence(present)).toEqual({ kind: "exists" });
      expect(await checkPathExistence(join(tempRoot, "absent.txt"))).toEqual({ kind: "missing" });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
