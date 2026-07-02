import { describe, expect, it } from "vitest";

import { projectSchema } from "../../src/index.js";

describe("project schema", () => {
  it("accepts a valid project file shape", () => {
    // 守る仕様: loomit.yml は一着で使う part.loom への参照を project root 相対パスとして保持する。
    const result = projectSchema.safeParse({
      schema: "loomit.project.v0",
      name: "my-blouse-001",
      garment: "blouse",
      parts: {
        body: "./parts/body/part.loom",
        sleeve: "./parts/sleeve/part.loom"
      },
      profiles: {
        default: "./profiles/my-size.yml"
      },
      test_suite: {
        required: ["arm-raise", "reach-forward"],
        ignored: {
          squat: {
            reason: "blouse, not relevant"
          }
        }
      },
      outputs: {
        dir: "./output"
      }
    });

    expect(result.success).toBe(true);
  });

  it("rejects a file with the wrong schema marker", () => {
    // 守る仕様: schema marker は file kind を判定するために必須で、project は loomit.project.v0 のみ受け付ける。
    const result = projectSchema.safeParse({
      schema: "loomit.part.v0",
      name: "my-blouse-001",
      garment: "blouse",
      parts: {
        body: "./parts/body/part.loom"
      }
    });

    expect(result.success).toBe(false);
  });
});
