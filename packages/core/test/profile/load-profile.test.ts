import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadProfileFile } from "../../src/profile/loadProfile.js";
import { profileSchema } from "../../src/schema/profile.schema.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/profiles");

describe("profile schema", () => {
  it("accepts body measurements", () => {
    // 守る仕様: profile schema は身体寸法(bust_cm/waist_cm など)を持つ profile を受理する。
    const result = profileSchema.safeParse({
      schema: "loomit.profile.v0",
      name: "my-size",
      measurements: {
        bust_cm: 84,
        waist_cm: 66
      }
    });

    expect(result.success).toBe(true);
  });

  it("requires at least one measurement", () => {
    // 守る仕様: measurements が空の profile は不正(最低1つの寸法が必要)。
    const result = profileSchema.safeParse({
      schema: "loomit.profile.v0",
      name: "empty",
      measurements: {}
    });

    expect(result.success).toBe(false);
  });
});

describe("loadProfileFile", () => {
  it("loads a valid profile", async () => {
    // 守る仕様: 妥当な profile ファイルは ok で読め、寸法値をそのまま参照できる。
    const result = await loadProfileFile(join(fixturesRoot, "my-size.yml"));

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.measurements.bust_cm : undefined).toBe(84);
  });

  it("returns diagnostics for invalid profile files", async () => {
    // 守る仕様: schema 不適合の profile は ok:false と PROFILE_SCHEMA_INVALID 診断(問題箇所つき)を返す。
    const filePath = join(fixturesRoot, "invalid-negative.yml");
    const result = await loadProfileFile(filePath);

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: "error",
          code: "PROFILE_SCHEMA_INVALID",
          message: "Profile file does not match the schema.",
          target: filePath,
          suggestion: ["問題の場所: measurements.bust_cm / Problem path: measurements.bust_cm"]
        }
      ]
    });
  });
});
