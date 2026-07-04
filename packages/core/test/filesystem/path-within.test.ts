import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { isPathWithin } from "../../src/index.js";

describe("isPathWithin", () => {
  it("accepts the root itself and nested paths", () => {
    // 守る仕様: root と同じ、または root 配下に収まるパスは許可する。
    const root = resolve("/projects/blouse");

    expect(isPathWithin(root, root)).toBe(true);
    expect(isPathWithin(root, resolve(root, "parts/body/part.loom"))).toBe(true);
  });

  it("rejects paths that escape the root via .. or an absolute path", () => {
    // 守る仕様: `..` や別ルートの絶対パスで root の外に出るパスは拒否する。
    const root = resolve("/projects/blouse");

    expect(isPathWithin(root, resolve(root, "../evil"))).toBe(false);
    expect(isPathWithin(root, resolve(root, "../../etc/passwd"))).toBe(false);
    expect(isPathWithin(root, resolve("/somewhere/else"))).toBe(false);
  });
});
