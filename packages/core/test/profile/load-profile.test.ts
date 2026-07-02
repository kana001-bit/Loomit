import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadProfileFile } from "../../src/profile/loadProfile.js";
import { profileSchema } from "../../src/schema/profile.schema.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/profiles");

describe("profile schema", () => {
  it("accepts body measurements", () => {
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
    const result = await loadProfileFile(join(fixturesRoot, "my-size.yml"));

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.measurements.bust_cm : undefined).toBe(84);
  });

  it("returns diagnostics for invalid profile files", async () => {
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
