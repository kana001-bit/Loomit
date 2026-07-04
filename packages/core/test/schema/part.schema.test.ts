import { describe, expect, it } from "vitest";

import { partSchema } from "../../src/index.js";

describe("part schema", () => {
  it("accepts a valid part using name and variant as separate identifiers", () => {
    // 守る仕様: part.loom は name と variant を分離し、variant を version の大小比較に使わない。
    const result = partSchema.safeParse({
      schema: "loomit.part.v0",
      name: "puff-sleeve",
      variant: "v3",
      type: "sleeve",
      status: "active",
      files: {
        source: "source.val",
        preview: "preview.svg",
        print: "print.pdf"
      },
      measurements: {
        finished: {
          bicep_width_mm: 320,
          sleeve_length_mm: 540
        }
      },
      connectors: {
        armhole: {
          type: "armhole",
          length_mm: 469,
          tolerance_mm: 3,
          path_ref: "svg:path#armhole",
          ranges: [
            {
              id: "sleeve-cap-gather",
              from: 0.18,
              to: 0.72,
              behavior: "gathered",
              allowance_mm: 18
            }
          ]
        }
      },
      requires: {
        "body.armhole.length_mm": {
          min: 466,
          max: 472
        }
      },
      tags: ["puff", "gathered", "fitted-armhole"]
    });

    expect(result.success).toBe(true);
  });

  it("accepts darts as id-keyed editing features", () => {
    // 守る仕様: darts は raw geometry ではなく、id 付きの編集フィーチャとして part.loom に保持できる。
    const result = partSchema.safeParse({
      schema: "loomit.part.v0",
      name: "darted-body",
      variant: "front-v1",
      type: "body",
      darts: {
        waist_front: {
          apex_ref: "val:point#waist_front_apex",
          width_mm: 30,
          intake_length_mm: 110,
          legs: {
            left_ref: "val:point#waist_front_leg_left",
            right_ref: "val:point#waist_front_leg_right"
          }
        }
      }
    });

    expect(result.success).toBe(true);
  });

  it("rejects the old version field shape", () => {
    // 守る仕様: part.loom は旧設計の version 番号に依存せず、name + variant で識別する。
    const result = partSchema.safeParse({
      schema: "loomit.part.v0",
      name: "puff-sleeve",
      version: 3,
      type: "sleeve"
    });

    expect(result.success).toBe(false);
  });

  it("rejects old requires version ranges", () => {
    // 守る仕様: requires は ">=4" のような version range ではなく、寸法などの直接条件で表す。
    const result = partSchema.safeParse({
      schema: "loomit.part.v0",
      name: "puff-sleeve",
      variant: "v3",
      type: "sleeve",
      requires: {
        "body.armhole": ">=4"
      }
    });

    expect(result.success).toBe(false);
  });

  it("rejects file reference paths that escape the part directory", () => {
    // 守る仕様: files.source/preview/print は part 相対に限る。悪意ある part.loom が絶対パスや
    // `..` で part/project 外のファイルを build に読ませ output へコピーさせるのを防ぐ。
    const parentEscape = partSchema.safeParse({
      schema: "loomit.part.v0",
      name: "puff-sleeve",
      variant: "v3",
      type: "sleeve",
      files: {
        source: "../../../secret"
      }
    });

    const absolutePath = partSchema.safeParse({
      schema: "loomit.part.v0",
      name: "puff-sleeve",
      variant: "v3",
      type: "sleeve",
      files: {
        preview: "/etc/passwd"
      }
    });

    expect(parentEscape.success).toBe(false);
    expect(absolutePath.success).toBe(false);
  });

  it("rejects a part type that is not a safe path segment", () => {
    // 守る仕様: type は library の types/<type>s/ ディレクトリ segment として使うので、`..` を含む
    // type は拒否する。
    const result = partSchema.safeParse({
      schema: "loomit.part.v0",
      name: "puff-sleeve",
      variant: "v3",
      type: "../../evil"
    });

    expect(result.success).toBe(false);
  });

  it("rejects negative connector finished lengths", () => {
    // 守る仕様: connectors.*.length_mm は仕上がり線上の長さであり、負の寸法は許可しない。
    const result = partSchema.safeParse({
      schema: "loomit.part.v0",
      name: "puff-sleeve",
      variant: "v3",
      type: "sleeve",
      connectors: {
        armhole: {
          type: "armhole",
          length_mm: -1
        }
      }
    });

    expect(result.success).toBe(false);
  });

  it("rejects duplicate connector range ids", () => {
    // 守る仕様: range id は connector 内で一意。重複を許すと diff が id をキーに突き合わせる際に
    // 先行 range を上書きし、変更を黙って取りこぼすため、正本 schema で禁止する。
    const result = partSchema.safeParse({
      schema: "loomit.part.v0",
      name: "puff-sleeve",
      variant: "v3",
      type: "sleeve",
      connectors: {
        armhole: {
          type: "armhole",
          length_mm: 469,
          ranges: [
            {
              id: "sleeve-cap-gather",
              from: 0.1,
              to: 0.3,
              behavior: "gathered"
            },
            {
              id: "sleeve-cap-gather",
              from: 0.5,
              to: 0.7,
              behavior: "gathered"
            }
          ]
        }
      }
    });

    expect(result.success).toBe(false);
  });

  it("rejects darts without both leg references", () => {
    // 守る仕様: dart は stable identity に紐づく apex と左右の leg 参照を持ち、片側だけ欠けた形は許可しない。
    const result = partSchema.safeParse({
      schema: "loomit.part.v0",
      name: "darted-body",
      variant: "front-v1",
      type: "body",
      darts: {
        waist_front: {
          apex_ref: "val:point#waist_front_apex",
          width_mm: 30,
          intake_length_mm: 110,
          legs: {
            left_ref: "val:point#waist_front_leg_left"
          }
        }
      }
    });

    expect(result.success).toBe(false);
  });
});
