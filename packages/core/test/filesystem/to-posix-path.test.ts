import { sep } from "node:path";

import { describe, expect, it } from "vitest";

import { toPosixPath } from "../../src/filesystem/toPosixPath.js";

describe("toPosixPath", () => {
  it("normalizes native path separators to POSIX", () => {
    // 守る仕様: 正本ファイルに保存する相対パスは、実行 OS の区切り文字に依存せず POSIX ("/") にする。
    // native な `sep` で連結したパスは、Windows("\\")でも POSIX("/")でも "/" 区切りに揃う。
    expect(toPosixPath(["parts", "body", "body.val"].join(sep))).toBe("parts/body/body.val");
  });

  it("leaves an already-POSIX path unchanged", () => {
    // 守る仕様: 既に "/" 区切りの相対パスは変更しない(POSIX 上での no-op を保証する)。
    expect(toPosixPath("output/parts/body/source/body.val")).toBe(
      "output/parts/body/source/body.val"
    );
  });
});
