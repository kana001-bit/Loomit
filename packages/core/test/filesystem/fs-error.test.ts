import { describe, expect, it } from "vitest";

import { describeFsError } from "../../src/index.js";

// `any` を使わずに、Node 流の errno ラベルを持たせた Error を組み立てる。
function fsError(code: string): Error {
  const error = new Error(code);
  Object.assign(error, { code });
  return error;
}

const context = {
  code: "PROJECT_CREATE_FAILED",
  message: "作成できませんでした。 / Could not create.",
  target: { kind: "file", path: "projects/blouse" }
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

  it("leaves exactly one Japanese/English boundary after appending the errno detail", () => {
    // 守る仕様: errno の詳細は英語のまま、日英併記の文を閉じたあとに括弧で1回だけ足す。
    // reason 自体を併記にすると `日本語 / English (日本語 / English)` になり、区切りが2つ出て
    // どちらが日英の切れ目か読めなくなる(全 errno 分岐で崩れないことをまとめて固定する)。
    for (const errno of ["EACCES", "EPERM", "ENOSPC", "EROFS", "EEXIST", "ENOENT"]) {
      const diagnostic = describeFsError(fsError(errno), context);

      expect(diagnostic.message.split(" / ")).toHaveLength(2);
      // 詳細は base message の後ろに付く(日本語側に割り込まない)。
      expect(diagnostic.message.startsWith(context.message)).toBe(true);
    }
  });

  it("still delivers the Japanese guidance through suggestion", () => {
    // 守る仕様: 詳細を英語にしても日本語話者が迷子にならない。errno ごとの「どうすればよいか」は
    // suggestion が日英併記で運ぶので、message から日本語の理由を落としても道案内は失われない。
    const diagnostic = describeFsError(fsError("EACCES"), context);

    expect(diagnostic.suggestion?.join(" ")).toContain("アクセス権限を確認してください");
    expect(diagnostic.suggestion?.join(" ")).toContain("Check file and directory permissions");
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
