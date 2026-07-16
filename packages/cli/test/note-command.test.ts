import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadPrototypeNotesFile } from "@loomit/core";
import type { PrototypeNote } from "@loomit/core";
import { describe, expect, it } from "vitest";

import { runNoteCommand } from "../src/commands/note.js";
import { EndOfInputError } from "../src/prompter.js";
import type { Prompter } from "../src/prompter.js";

// select / input / confirm をそれぞれ別キューで返す scripted prompter。キューが尽きた input は、default が
// あればそれ(=任意項目の skip / リスト打ち切りを模す)、無ければ EOF(必須 prompt をハングさせない)。
function scriptedPrompter(script: {
  readonly inputs?: readonly string[];
  readonly selects?: readonly string[];
  readonly confirms?: readonly boolean[];
}): Prompter {
  const inputs = [...(script.inputs ?? [])];
  const selects = [...(script.selects ?? [])];
  const confirms = [...(script.confirms ?? [])];

  return {
    input: (_question, options) => {
      if (inputs.length > 0) {
        return Promise.resolve(inputs.shift() as string);
      }

      return options?.default !== undefined
        ? Promise.resolve(options.default)
        : Promise.reject(new EndOfInputError());
    },
    select: (_question, _choices, options) =>
      Promise.resolve(selects.shift() ?? options?.default ?? ""),
    confirm: (_question, options) => Promise.resolve(confirms.shift() ?? options?.default ?? false),
    close: () => {}
  };
}

// prompter を一切呼ばれてはいけないケース用(project が無ければ prompt する前に失敗するはず)。
const throwingPrompter: Prompter = {
  input: () => Promise.reject(new Error("input() must not be called")),
  select: () => Promise.reject(new Error("select() must not be called")),
  confirm: () => Promise.reject(new Error("confirm() must not be called")),
  close: () => {}
};

async function makeProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "loomit-note-"));

  await writeFile(
    join(root, "loomit.yml"),
    ["schema: loomit.project.v0", "name: note-blouse", "garment: blouse", "parts: {}"].join("\n"),
    "utf8"
  );

  return root;
}

async function readNotes(root: string): Promise<readonly PrototypeNote[]> {
  const loaded = await loadPrototypeNotesFile(join(root, "notes/prototype-notes.yml"));

  if (!loaded.ok) {
    throw new Error("Expected the notes file to load.");
  }

  return loaded.value.notes;
}

describe("loom note", () => {
  it("records a note with only the required result and issue", async () => {
    // 守る仕様: result と issue だけ答えれば note を1件記録し、任意項目(observation/creates_test_case/applies_to 等)は入れなければ載らない。
    const root = await makeProject();
    const out: string[] = [];
    const err: string[] = [];

    try {
      const code = await runNoteCommand([], {
        cwd: root,
        stdout: (text) => out.push(text),
        stderr: (text) => err.push(text),
        prompter: scriptedPrompter({
          selects: ["failed"],
          inputs: ["armhole tight when raising arms"],
          confirms: [false]
        })
      });

      expect(err.join("")).toBe("");
      expect(code).toBe(0);

      const written = await readNotes(root);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        result: "failed",
        issue: "armhole tight when raising arms"
      });
      // 任意項目・movement test は入れていないので載らない。
      expect(written[0]).not.toHaveProperty("creates_test_case");
      expect(written[0]).not.toHaveProperty("applies_to");
      expect(written[0]).not.toHaveProperty("observation");
      expect(out.join("")).toContain("Recorded prototype note");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("records a movement test case with applies-to tags when confirmed", async () => {
    // 守る仕様: movement test を確認したら creates_test_case と applies_to タグを対で記録する。
    const root = await makeProject();
    const out: string[] = [];
    const err: string[] = [];

    try {
      const code = await runNoteCommand([], {
        cwd: root,
        stdout: (text) => out.push(text),
        stderr: (text) => err.push(text),
        prompter: scriptedPrompter({
          selects: ["failed"],
          inputs: [
            "armhole tight when raising arms", // issue
            "", // label (skip)
            "", // observation list (finish)
            "", // suggested_change list (finish)
            "arm-raise", // creates_test_case
            "fitted-armhole", // applies_to (required first)
            "non-stretch-fabric", // applies_to (another)
            "" // applies_to (finish)
          ],
          confirms: [true]
        })
      });

      expect(err.join("")).toBe("");
      expect(code).toBe(0);

      const written = await readNotes(root);
      expect(written[0]).toMatchObject({
        result: "failed",
        issue: "armhole tight when raising arms",
        creates_test_case: "arm-raise",
        applies_to: ["fitted-armhole", "non-stretch-fabric"]
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("appends to an existing note file across two invocations", async () => {
    // 守る仕様: 2回目の loom note は既存 note ファイルに追記し、以前の note を保つ。
    const root = await makeProject();

    try {
      const first = await runNoteCommand([], {
        cwd: root,
        stdout: () => {},
        stderr: () => {},
        prompter: scriptedPrompter({
          selects: ["failed"],
          inputs: ["waist gaps"],
          confirms: [false]
        })
      });
      const second = await runNoteCommand([], {
        cwd: root,
        stdout: () => {},
        stderr: () => {},
        prompter: scriptedPrompter({
          selects: ["ok"],
          inputs: ["sleeve eases cleanly"],
          confirms: [false]
        })
      });

      expect(first).toBe(0);
      expect(second).toBe(0);

      const written = await readNotes(root);
      expect(written.map((note) => note.issue)).toEqual(["waist gaps", "sleeve eases cleanly"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails cleanly (writing nothing) when input ends before the required issue", async () => {
    // 守る仕様: 必須の issue に届く前に入力が尽きたら clean fail(exit 1)し、note ファイルは作らない。
    const root = await makeProject();
    const err: string[] = [];

    try {
      const code = await runNoteCommand([], {
        cwd: root,
        stdout: () => {},
        stderr: (text) => err.push(text),
        prompter: scriptedPrompter({ selects: ["failed"], inputs: [] })
      });

      expect(code).toBe(1);
      expect(err.join("")).toContain("Input ended");
      await expect(readFile(join(root, "notes/prototype-notes.yml"), "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails before prompting when there is no Loomit project", async () => {
    // 守る仕様: Loomit プロジェクトが無い場所では prompt する前に失敗する(prompter は呼ばれない)。
    const root = await mkdtemp(join(tmpdir(), "loomit-note-noproj-"));
    const err: string[] = [];

    try {
      const code = await runNoteCommand([], {
        cwd: root,
        stdout: () => {},
        stderr: (text) => err.push(text),
        prompter: throwingPrompter
      });

      expect(code).toBe(1);
      expect(err.join("")).not.toBe("");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("prints help and exits 0 on --help", async () => {
    // 守る仕様: --help は使い方を表示して exit 0(prompt しない)。
    const out: string[] = [];

    const code = await runNoteCommand(["--help"], {
      cwd: process.cwd(),
      stdout: (text) => out.push(text),
      stderr: () => {},
      prompter: throwingPrompter
    });

    expect(code).toBe(0);
    expect(out.join("")).toContain("Usage: loom note");
  });
});
