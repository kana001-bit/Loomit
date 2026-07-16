import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import { addPrototypeNote, loadPrototypeNotesFile } from "../../src/index.js";

async function makeProject(): Promise<string> {
  const tempRoot = await mkdtemp(join(tmpdir(), "loomit-add-note-"));

  await writeFile(
    join(tempRoot, "loomit.yml"),
    ["schema: loomit.project.v0", "name: note-blouse", "garment: blouse", "parts: {}"].join("\n"),
    "utf8"
  );

  return tempRoot;
}

describe("addPrototypeNote", () => {
  it("creates notes/prototype-notes.yml from scratch and writes a schema-valid note", async () => {
    // 守る仕様: 初回は notes/prototype-notes.yml を新規作成し、id を date+slug から組んで schema 妥当な note を書く。
    const projectRoot = await makeProject();

    try {
      const result = await addPrototypeNote({
        projectPath: projectRoot,
        result: "failed",
        issue: "armhole tight when raising arms",
        observation: ["bodice lifts when arms are raised"],
        suggestedChange: ["lower sleeve cap", "increase armhole ease"],
        createsTestCase: "arm-raise",
        appliesTo: ["fitted-armhole", "non-stretch-fabric"],
        date: "2026-07-12"
      });

      expect(result.ok).toBe(true);

      if (!result.ok) {
        return;
      }

      expect(result.value.created).toBe(true);
      expect(result.value.note).toEqual({
        id: "note-2026-07-12-armhole-tight-when-raising-arms",
        date: "2026-07-12",
        result: "failed",
        issue: "armhole tight when raising arms",
        observation: ["bodice lifts when arms are raised"],
        suggested_change: ["lower sleeve cap", "increase armhole ease"],
        creates_test_case: "arm-raise",
        applies_to: ["fitted-armhole", "non-stretch-fabric"]
      });

      // 書き出したファイルは読み直し側の schema 検証を通る(round-trip)。
      const reloaded = await loadPrototypeNotesFile(result.value.notesFilePath);
      expect(reloaded.ok).toBe(true);
      if (reloaded.ok) {
        expect(reloaded.value.notes).toHaveLength(1);
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("appends to an existing notes file, keeping earlier notes", async () => {
    // 守る仕様: 既存の notes ファイルには追記し、以前の note を消さず順序を保つ(created は false)。
    const projectRoot = await makeProject();

    try {
      const first = await addPrototypeNote({
        projectPath: projectRoot,
        result: "failed",
        issue: "waist gaps at center back",
        label: "waist-gap",
        date: "2026-07-10"
      });
      expect(first.ok).toBe(true);

      const second = await addPrototypeNote({
        projectPath: projectRoot,
        result: "ok",
        issue: "sleeve cap eases in cleanly",
        label: "sleeve-cap",
        date: "2026-07-12"
      });
      expect(second.ok).toBe(true);

      if (!second.ok) {
        return;
      }

      expect(second.value.created).toBe(false);

      const reloaded = await loadPrototypeNotesFile(second.value.notesFilePath);
      expect(reloaded.ok).toBe(true);
      if (reloaded.ok) {
        expect(reloaded.value.notes.map((note) => note.id)).toEqual([
          "note-2026-07-10-waist-gap",
          "note-2026-07-12-sleeve-cap"
        ]);
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("disambiguates a colliding id (same date and slug) with a numeric suffix", async () => {
    // 守る仕様: date と slug が同じで id が衝突する場合は、-2 のような数値 suffix で一意化する。
    const projectRoot = await makeProject();

    try {
      const first = await addPrototypeNote({
        projectPath: projectRoot,
        result: "failed",
        issue: "armhole tight",
        label: "armhole",
        date: "2026-07-12"
      });
      const second = await addPrototypeNote({
        projectPath: projectRoot,
        result: "failed",
        issue: "armhole still tight after ease",
        label: "armhole",
        date: "2026-07-12"
      });

      expect(first.ok && second.ok).toBe(true);

      if (!first.ok || !second.ok) {
        return;
      }

      expect(first.value.note.id).toBe("note-2026-07-12-armhole");
      expect(second.value.note.id).toBe("note-2026-07-12-armhole-2");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("falls back to a 'note' slug when the label has no ascii tokens", async () => {
    // 守る仕様: label に ascii トークンが無い(日本語のみ等)ときは slug を "note" にフォールバックする(id は date で一意化される)。
    const projectRoot = await makeProject();

    try {
      const result = await addPrototypeNote({
        projectPath: projectRoot,
        result: "failed",
        issue: "袖ぐりが突っ張る",
        date: "2026-07-12"
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.note.id).toBe("note-2026-07-12-note");
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects creates_test_case without applies_to (paired fields) before writing", async () => {
    // 守る仕様: creates_test_case と applies_to は対で、片方だけの入力は書き込み前に PROTOTYPE_NOTE_ADD_SCHEMA_INVALID で弾く。
    const projectRoot = await makeProject();

    try {
      const result = await addPrototypeNote({
        projectPath: projectRoot,
        result: "failed",
        issue: "armhole tight",
        createsTestCase: "arm-raise"
        // applies_to intentionally omitted
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics[0]?.code).toBe("PROTOTYPE_NOTE_ADD_SCHEMA_INVALID");
      }

      // 検証で弾かれたので notes ファイルは作られない。
      await expect(readFile(join(projectRoot, "notes/prototype-notes.yml"), "utf8")).rejects.toThrow();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("returns the load failure when an existing notes file is malformed", async () => {
    // 守る仕様: 既存 notes ファイルが壊れているときは追記を試みず、読み込み時の PROTOTYPE_NOTES_SCHEMA_INVALID を返す。
    const projectRoot = await makeProject();

    try {
      await mkdir(join(projectRoot, "notes"), { recursive: true });
      await writeFile(
        join(projectRoot, "notes/prototype-notes.yml"),
        "schema: loomit.prototype_notes.v0\nnotes: not-a-list\n",
        "utf8"
      );

      const result = await addPrototypeNote({
        projectPath: projectRoot,
        result: "failed",
        issue: "armhole tight",
        date: "2026-07-12"
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics[0]?.code).toBe("PROTOTYPE_NOTES_SCHEMA_INVALID");
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("keeps leftover_fabric only when it carries a field", async () => {
    // 守る仕様: leftover_fabric は中身(field)があるときだけ書き、空なら省く(空オブジェクトを残さない)。
    const projectRoot = await makeProject();

    try {
      const result = await addPrototypeNote({
        projectPath: projectRoot,
        result: "ok",
        issue: "collar drafted with leftover",
        label: "collar",
        date: "2026-07-12",
        leftoverFabric: { reusableFor: ["cuff"], remainingSize: "30cm x 40cm" }
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }

      const written = parse(await readFile(result.value.notesFilePath, "utf8")) as {
        notes: { leftover_fabric?: unknown }[];
      };
      expect(written.notes[0]?.leftover_fabric).toEqual({
        reusable_for: ["cuff"],
        remaining_size: "30cm x 40cm"
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
