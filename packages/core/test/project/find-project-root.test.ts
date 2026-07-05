import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  stat: vi.fn()
}));

vi.mock("node:fs/promises", () => ({
  access: mocks.access,
  stat: mocks.stat
}));

import { findProjectRoot } from "../../src/index.js";

describe("findProjectRoot", () => {
  beforeEach(() => {
    mocks.access.mockReset();
    mocks.stat.mockReset();
  });

  it("stops and reports an access failure when loomit.yml is unreadable", async () => {
    // 守る仕様: loomit.yml が権限エラーで読めないときは、探索を打ち切って PROJECT_ROOT_ACCESS_FAILED
    // を返す(「見つからない」に化けさせない)。開始パスは OS 依存にせず、実行 OS の絶対パスを使う。
    const projectRoot = join(tmpdir(), "loomit-find-root-project");
    const projectFilePath = join(projectRoot, "loomit.yml");

    mocks.stat.mockResolvedValue({
      isFile: () => false
    });
    mocks.access.mockImplementation(async (candidate: string) => {
      if (candidate === projectFilePath) {
        throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      }

      return undefined;
    });

    const result = await findProjectRoot(projectRoot);

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          severity: "error",
          code: "PROJECT_ROOT_ACCESS_FAILED",
          target: projectFilePath
        })
      ]
    });
    expect(mocks.access).toHaveBeenCalledTimes(1);
    expect(mocks.access).toHaveBeenCalledWith(projectFilePath);
  });
});
