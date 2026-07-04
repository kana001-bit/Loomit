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
    const projectRoot = "C:\\workspace\\project";
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
