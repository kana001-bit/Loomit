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

  it("rejects part reference paths that escape the project root", () => {
    // 守る仕様: loomit.yml の参照パスは project root 相対に限る。絶対パスや `..` エスケープは拒否する。
    const parentEscape = projectSchema.safeParse({
      schema: "loomit.project.v0",
      name: "my-blouse-001",
      garment: "blouse",
      parts: {
        body: "../../../etc/passwd"
      }
    });

    const absolutePath = projectSchema.safeParse({
      schema: "loomit.project.v0",
      name: "my-blouse-001",
      garment: "blouse",
      parts: {
        body: "/etc/passwd"
      }
    });

    expect(parentEscape.success).toBe(false);
    expect(absolutePath.success).toBe(false);
  });

  it("rejects a part role key that is not a safe path segment", () => {
    // 守る仕様: role は parts/<role>/ のディレクトリ segment として使うので、`..` や区切り文字を含む
    // role は拒否する(part.type を同じ値にして resolveParts の mismatch を回避する経路を塞ぐ)。
    const parentEscape = projectSchema.safeParse({
      schema: "loomit.project.v0",
      name: "my-blouse-001",
      garment: "blouse",
      parts: {
        "../../../outside": "./parts/body/part.loom"
      }
    });

    const withSeparator = projectSchema.safeParse({
      schema: "loomit.project.v0",
      name: "my-blouse-001",
      garment: "blouse",
      parts: {
        "nested/role": "./parts/body/part.loom"
      }
    });

    expect(parentEscape.success).toBe(false);
    expect(withSeparator.success).toBe(false);
  });

  it("rejects an outputs.dir that overlaps the project root or a durable scaffold", () => {
    // 守る仕様: output は再生成領域。root(.) や durable scaffold(parts/notes/profiles)を output に
    // 指定すると fork の output 除外が durable state を巻き込むため、これらは load 時に拒否する。
    const scaffoldOverlap = projectSchema.safeParse({
      schema: "loomit.project.v0",
      name: "my-blouse-001",
      garment: "blouse",
      parts: { body: "./parts/body/part.loom" },
      outputs: { dir: "./parts" }
    });

    const scaffoldChild = projectSchema.safeParse({
      schema: "loomit.project.v0",
      name: "my-blouse-001",
      garment: "blouse",
      parts: { body: "./parts/body/part.loom" },
      outputs: { dir: "./parts/body" }
    });

    // 大文字小文字を区別しない FS では ./Parts と ./parts が同じ場所なので、大小違いでも拒否する。
    const caseInsensitiveOverlap = projectSchema.safeParse({
      schema: "loomit.project.v0",
      name: "my-blouse-001",
      garment: "blouse",
      parts: { body: "./parts/body/part.loom" },
      outputs: { dir: "./Parts" }
    });

    const rootOutput = projectSchema.safeParse({
      schema: "loomit.project.v0",
      name: "my-blouse-001",
      garment: "blouse",
      parts: {},
      outputs: { dir: "." }
    });

    expect(scaffoldOverlap.success).toBe(false);
    expect(scaffoldChild.success).toBe(false);
    expect(caseInsensitiveOverlap.success).toBe(false);
    expect(rootOutput.success).toBe(false);
  });

  it("rejects an outputs.dir that escapes the project root", () => {
    // 守る仕様: outputs.dir も project root 配下に限定し、`..` で外へ出る指定は拒否する。
    const result = projectSchema.safeParse({
      schema: "loomit.project.v0",
      name: "my-blouse-001",
      garment: "blouse",
      parts: {},
      outputs: {
        dir: "../outside"
      }
    });

    expect(result.success).toBe(false);
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
