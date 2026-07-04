import { describe, expect, it } from "vitest";

import { describeFsError } from "../../src/index.js";

// Build an Error carrying a Node-style errno label, without using `any`.
function fsError(code: string): Error {
  const error = new Error(code);
  Object.assign(error, { code });
  return error;
}

const context = {
  code: "PROJECT_CREATE_FAILED",
  message: "作成できませんでした。 / Could not create.",
  target: "/projects/blouse"
} as const;

describe("describeFsError", () => {
  it("keeps the operation code and explains permission errors", () => {
    // 守る仕様: EACCES は operation code を保ちつつ、権限が原因だと分かる message/suggestion にする。
    const diagnostic = describeFsError(fsError("EACCES"), context);

    expect(diagnostic.code).toBe("PROJECT_CREATE_FAILED");
    expect(diagnostic.message).toContain("permission denied");
    expect(diagnostic.suggestion?.join(" ")).toContain("permissions");
  });

  it("distinguishes out-of-space and not-found from each other", () => {
    // 守る仕様: ENOSPC と ENOENT は同じ generic message に潰さず、別々の原因として説明する。
    const noSpace = describeFsError(fsError("ENOSPC"), context);
    const notFound = describeFsError(fsError("ENOENT"), context);

    expect(noSpace.message).toContain("no space left on device");
    expect(notFound.message).toContain("path not found");
    expect(noSpace.message).not.toBe(notFound.message);
  });

  it("falls back to the base message for unknown errors", () => {
    // 守る仕様: errno が取れない/未知の場合は base message と fallback suggestion をそのまま使う。
    const diagnostic = describeFsError(new Error("boom"), {
      ...context,
      suggestion: ["Check the target path and filesystem permissions."]
    });

    expect(diagnostic.message).toBe(context.message);
    expect(diagnostic.suggestion).toEqual(["Check the target path and filesystem permissions."]);
  });
});
