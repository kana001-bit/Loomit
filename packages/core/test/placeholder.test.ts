import { describe, expect, it } from "vitest";

import { corePackageName } from "../src/index.js";

describe("core package scaffold", () => {
  it("exports the package marker", () => {
    // 守る仕様: Milestone 0 では core package が TypeScript/Vitest から読み込める。
    expect(corePackageName).toBe("@loomit/core");
  });
});
