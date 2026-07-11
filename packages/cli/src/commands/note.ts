import { relative } from "node:path";

import { addPrototypeNote, loadProject } from "@loomit/core";
import type { AddedPrototypeNote, AddPrototypeNoteInput } from "@loomit/core";
import { formatDiagnosticsText } from "../formatters/diagnosticsText.js";
import { createReadlinePrompter, EndOfInputError } from "../prompter.js";
import type { Prompter } from "../prompter.js";

export interface NoteCommandOptions {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  // テストは scripted Prompter を注入する。未指定なら readline で対話する(loom add と同じ流儀)。
  readonly prompter?: Prompter;
}

interface ParsedNoteArgs {
  readonly help: boolean;
}

// result の候補。schema 上は自由文字列だが、よく使う結果を出して選びやすくする("other" は自由入力)。
const RESULT_CHOICES = ["failed", "ok", "mixed", "other"] as const;

export async function runNoteCommand(
  args: readonly string[],
  options: NoteCommandOptions
): Promise<number> {
  const parsedArgs = parseNoteArgs(args);

  if (typeof parsedArgs === "string") {
    options.stderr(`${parsedArgs}\n\n${formatNoteHelp()}`);
    return 2;
  }

  if (parsedArgs.help) {
    options.stdout(formatNoteHelp());
    return 0;
  }

  // 対話を始める前に project を確認する。無ければ即座に失敗させ、全項目を入力させた最後に「project が無い」と
  // 言う無駄をなくす(loom add が .val の存在を先に確かめるのと同じ精神。core も書き込み直前に再確認する)。
  const loaded = await loadProject(options.cwd);

  if (!loaded.ok) {
    options.stderr(`${formatDiagnosticsText(loaded.diagnostics).join("\n")}\n`);
    return 1;
  }

  const prompter = options.prompter ?? createReadlinePrompter();

  try {
    const input = await collectNoteAnswers(prompter, options.stdout, options.cwd);
    const result = await addPrototypeNote(input);

    if (!result.ok) {
      options.stderr(`${formatDiagnosticsText(result.diagnostics).join("\n")}\n`);
      return 1;
    }

    options.stdout(formatNoteSuccess(result.value, options.cwd));
    return 0;
  } catch (error) {
    // パイプ/リダイレクト入力が必要な回答数に足りず、default で埋められない必須 prompt(issue 等)に達したとき。
    // 空回答で問い直し続けてハングするより、ここで綺麗に失敗終了させる(loom add と同じ)。
    if (error instanceof EndOfInputError) {
      options.stderr(
        "Input ended before all required answers were provided.\n" +
          "Provide every required answer, or run it in an interactive terminal.\n"
      );
      return 1;
    }

    throw error;
  } finally {
    prompter.close();
  }
}

export function formatNoteHelp(): string {
  return [
    "Usage: loom note",
    "",
    "Record a prototype note (a learning from a toile) into notes/prototype-notes.yml.",
    "Prompts for the result and issue, plus optional observations, suggested",
    "changes, and a movement test case with the tags it applies to. loom diff",
    "surfaces matching notes when you later change a part with those tags.",
    "",
    "Options:",
    "  --help  Show this help."
  ].join("\n") + "\n";
}

// note 1件分の回答を集める。必須は result / issue。任意は label(id 用)/ observation / suggested_change。
// creates_test_case と applies_to は schema 上「対で必須」なので、まとめて訊く(片方だけにならない)。
async function collectNoteAnswers(
  prompter: Prompter,
  notify: (text: string) => void,
  projectPath: string
): Promise<AddPrototypeNoteInput> {
  const result = await promptResult(prompter, notify);
  const issue = await promptNonEmpty(prompter, notify, "Issue (what went wrong / what you saw)");
  // label は id の slug 元。日本語 issue だと slug 化できないので、短い英字ラベルを任意で受ける。空なら
  // core が issue から slug を作り(英字が無ければ "note")、date で一意化する。
  const label = await promptOptional(prompter, "Short label for the id (optional, ascii)");
  const observation = await promptList(prompter, "Observation");
  const suggestedChange = await promptList(prompter, "Suggested change");

  const recordTest = await prompter.confirm("Record a movement test case (with applies-to tags)?", {
    default: false
  });

  const testCase = recordTest
    ? {
        createsTestCase: await promptNonEmpty(prompter, notify, "Movement test case id"),
        appliesTo: await promptRequiredList(prompter, notify, "Applies-to tag")
      }
    : undefined;

  return {
    projectPath,
    result,
    issue,
    ...(label === undefined ? {} : { label }),
    ...(observation.length === 0 ? {} : { observation }),
    ...(suggestedChange.length === 0 ? {} : { suggestedChange }),
    ...(testCase === undefined
      ? {}
      : { createsTestCase: testCase.createsTestCase, appliesTo: testCase.appliesTo })
  };
}

// result を訊く。よく使う結果から選ばせ、"other" のときだけ自由入力(schema 上 result は自由文字列)。
async function promptResult(prompter: Prompter, notify: (text: string) => void): Promise<string> {
  const chosen = await prompter.select("Result", RESULT_CHOICES, { default: "failed" });

  if (chosen !== "other") {
    return chosen;
  }

  return promptNonEmpty(prompter, notify, "Custom result");
}

// 空でない自由文字列を、非空になるまで訊き直す(必須項目用)。EOF は default 無しなので呼び手の catch へ抜ける。
async function promptNonEmpty(
  prompter: Prompter,
  notify: (text: string) => void,
  label: string
): Promise<string> {
  for (;;) {
    const value = await prompter.input(label);

    if (value.length > 0) {
      return value;
    }

    notify("Enter a value.\n");
  }
}

// 任意の単一入力。空 Enter でも EOF でも undefined を返す(default "" を渡すことで EOF でハングも失敗もさせない)。
async function promptOptional(prompter: Prompter, label: string): Promise<string | undefined> {
  const value = await prompter.input(`${label} (Enter to skip)`, { default: "" });
  return value === "" ? undefined : value;
}

// 任意の複数入力。空行(または EOF)で打ち切る。各行に default "" を渡すことで、パイプ入力が尽きても
// リストを綺麗に閉じられる(必須項目のように EOF で失敗させない)。
async function promptList(prompter: Prompter, label: string): Promise<string[]> {
  const items: string[] = [];

  for (;;) {
    const value = await prompter.input(`${label} (Enter to finish)`, { default: "" });

    if (value === "") {
      return items;
    }

    items.push(value);
  }
}

// 少なくとも1件を要求する複数入力(applies_to は schema 上 min(1))。1件目は必須、以降は任意。
async function promptRequiredList(
  prompter: Prompter,
  notify: (text: string) => void,
  label: string
): Promise<string[]> {
  const first = await promptNonEmpty(prompter, notify, `${label} (at least one)`);
  const rest = await promptList(prompter, label);
  return [first, ...rest];
}

function formatNoteSuccess(added: AddedPrototypeNote, cwd: string): string {
  const rel = relative(cwd, added.notesFilePath).split("\\").join("/");
  const state = added.created ? "created" : "updated";

  return [
    `Recorded prototype note "${added.note.id}":`,
    `  ${rel}   (${state})`,
    "",
    "Next: loom diff surfaces this note when you change a part with its applies-to tags."
  ].join("\n") + "\n";
}

function parseNoteArgs(args: readonly string[]): ParsedNoteArgs | string {
  let help = false;

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    return `Unknown argument: ${arg}`;
  }

  return { help };
}
