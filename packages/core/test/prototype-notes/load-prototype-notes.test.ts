import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadPrototypeNotesFile } from "../../src/prototype-notes/loadPrototypeNotes.js";
import { prototypeNotesSchema } from "../../src/schema/prototype-notes.schema.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/prototype-notes");

describe("prototype notes schema", () => {
  it("accepts a note with a test case and applies_to tags", () => {
    const result = prototypeNotesSchema.safeParse({
      schema: "loomit.prototype_notes.v0",
      notes: [
        {
          id: "note-1",
          date: "2026-06-28",
          result: "failed",
          issue: "armhole tight when raising arms",
          creates_test_case: "arm-raise",
          applies_to: ["fitted-armhole", "non-stretch-fabric"]
        }
      ]
    });

    expect(result.success).toBe(true);
  });

  it("rejects a test case without applies_to tags", () => {
    const result = prototypeNotesSchema.safeParse({
      schema: "loomit.prototype_notes.v0",
      notes: [
        {
          id: "note-1",
          date: "2026-06-28",
          result: "failed",
          issue: "armhole tight when raising arms",
          creates_test_case: "arm-raise"
        }
      ]
    });

    expect(result.success).toBe(false);
  });
});

describe("loadPrototypeNotesFile", () => {
  it("loads valid prototype notes", async () => {
    const result = await loadPrototypeNotesFile(join(fixturesRoot, "valid/prototype-notes.yml"));

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.notes[0]?.creates_test_case : undefined).toBe("arm-raise");
    expect(result.ok ? result.value.notes[0]?.applies_to : undefined).toEqual([
      "fitted-armhole",
      "non-stretch-fabric"
    ]);
  });

  it("returns diagnostics for invalid prototype notes", async () => {
    const filePath = join(fixturesRoot, "invalid-missing-applies-to/prototype-notes.yml");
    const result = await loadPrototypeNotesFile(filePath);

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: "error",
          code: "PROTOTYPE_NOTES_SCHEMA_INVALID",
          message:
            "試作メモファイルの形式が schema と一致しません。/ The prototype notes file does not match the schema.",
          target: filePath,
          suggestion: ["問題の場所: notes.0 / Problem path: notes.0"]
        }
      ]
    });
  });
});
