import { access, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stringify } from "yaml";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { describeFsError } from "../filesystem/fsError.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";
import { writeFileAtomic } from "../filesystem/writeFileAtomic.js";
import { loadProject } from "../project/loadProject.js";
import { prototypeNotesSchema } from "../schema/prototype-notes.schema.js";
import type { PrototypeNote, PrototypeNotes } from "../schema/prototype-notes.schema.js";
import { loadPrototypeNotesFile } from "./loadPrototypeNotes.js";

// prototype note の置き場所(project root からの相対)。read 側(diff / test / suggest-tests)と同じ規約。
const NOTES_RELATIVE_PATH = ["notes", "prototype-notes.yml"] as const;

// 対話ウィザード(CLI 側)が集めた回答を受け取り、notes/prototype-notes.yml に1件「追記」する純粋な書き込み。
// prompt は持ち込まない(core / CLI 分離: 対話は CLI、決定済みの値からの生成は core。loom add と同じ分業)。
// 手書き YAML をやめて試作の学びをその場で記録できるようにする入口。
export interface AddPrototypeNoteLeftoverFabricInput {
  readonly reusableFor?: readonly string[];
  readonly remainingSize?: string;
}

export interface AddPrototypeNoteInput {
  // project を探す起点(通常は cwd)。ここから loomit.yml を見つけ、その隣の notes/ に書く。
  readonly projectPath: string;
  readonly result: string;
  readonly issue: string;
  readonly observation?: readonly string[];
  readonly suggestedChange?: readonly string[];
  // creates_test_case と appliesTo は schema 上「対で必須」。片方だけ渡すと下の全体検証で弾かれる。
  readonly createsTestCase?: string;
  readonly appliesTo?: readonly string[];
  readonly leftoverFabric?: AddPrototypeNoteLeftoverFabricInput;
  // id の slug 元。省略時は issue から生成する。日本語 issue で slug 化できないときの明示ラベル。
  readonly label?: string;
  // 今日の日付(YYYY-MM-DD)。テストのため注入可能。省略時は実行日。
  readonly date?: string;
}

export interface AddedPrototypeNote {
  readonly note: PrototypeNote;
  readonly notesFilePath: string;
  // notes/prototype-notes.yml を新規作成したか(既存に追記したか)。
  readonly created: boolean;
}

export async function addPrototypeNote(
  input: AddPrototypeNoteInput
): Promise<LoadFileResult<AddedPrototypeNote>> {
  const loadedProjectResult = await loadProject(input.projectPath);

  if (!loadedProjectResult.ok) {
    return loadedProjectResult;
  }

  const { projectRoot } = loadedProjectResult.value.paths;
  const notesFilePath = join(projectRoot, ...NOTES_RELATIVE_PATH);

  // 既存ノートを読む。無ければ空から始める。存在するのに読めない/schema 不整合はそのまま失敗として
  // 返す(壊れたファイルに追記して被害を広げない)。
  const notesExist = await pathExists(notesFilePath);
  let existing: PrototypeNotes = { schema: "loomit.prototype_notes.v0", notes: [] };

  if (notesExist) {
    const loaded = await loadPrototypeNotesFile(notesFilePath);

    if (!loaded.ok) {
      return loaded;
    }

    existing = loaded.value;
  }

  const date = input.date ?? today();
  const id = uniqueNoteId(date, input.label ?? input.issue, existing.notes);
  const draftNote = buildDraftNote(input, id, date);

  const draftFile = {
    schema: "loomit.prototype_notes.v0",
    notes: [...existing.notes, draftNote]
  };

  // 追記後のファイル全体を正本 schema で検証する。creates_test_case と applies_to の「対で必須」など、
  // CLI 側で弾ききれない不整合を、壊れた YAML を書く前にここで止める(loom add の buildPart と同じ関所)。
  const parsed = prototypeNotesSchema.safeParse(draftFile);

  if (!parsed.success) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "PROTOTYPE_NOTE_ADD_SCHEMA_INVALID",
          message: "The prototype note to add does not match the schema.",
          target: notesFilePath,
          suggestion: [parsed.error.issues.map((issue) => issue.message).join("; ")]
        })
      ]
    };
  }

  const note = parsed.data.notes[parsed.data.notes.length - 1];

  if (note === undefined) {
    // 直前に必ず1件足しているので到達しない。型を確定させるための防御。
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "PROTOTYPE_NOTE_ADD_FAILED",
          message: "The prototype note could not be constructed.",
          target: notesFilePath
        })
      ]
    };
  }

  try {
    // notes/ ディレクトリが無ければ作る(writeFileAtomic は親ディレクトリを作らない)。
    await mkdir(dirname(notesFilePath), { recursive: true });
    await writeFileAtomic(notesFilePath, stringify(parsed.data));
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        describeFsError(error, {
          code: "PROTOTYPE_NOTE_ADD_FAILED",
          message: "Could not write the prototype note.",
          target: notesFilePath,
          suggestion: ["Check the project path and filesystem permissions."]
        })
      ]
    };
  }

  return {
    ok: true,
    value: { note, notesFilePath, created: !notesExist },
    diagnostics: []
  };
}

// 回答から note の下書きを組み立てる。空配列/未指定の optional は載せない(schema の min(1) と、
// 「無い項目は書かない」方針に合わせる)。型付けは上の safeParse 経由で確定させる。
function buildDraftNote(input: AddPrototypeNoteInput, id: string, date: string): Record<string, unknown> {
  return {
    id,
    date,
    result: input.result,
    issue: input.issue,
    ...(hasItems(input.observation) ? { observation: [...input.observation] } : {}),
    ...(hasItems(input.suggestedChange) ? { suggested_change: [...input.suggestedChange] } : {}),
    ...(input.createsTestCase === undefined ? {} : { creates_test_case: input.createsTestCase }),
    ...(hasItems(input.appliesTo) ? { applies_to: [...input.appliesTo] } : {}),
    ...buildLeftoverFabric(input.leftoverFabric)
  };
}

function buildLeftoverFabric(
  leftover: AddPrototypeNoteLeftoverFabricInput | undefined
): Record<string, unknown> {
  if (leftover === undefined) {
    return {};
  }

  const value = {
    ...(hasItems(leftover.reusableFor) ? { reusable_for: [...leftover.reusableFor] } : {}),
    ...(leftover.remainingSize === undefined ? {} : { remaining_size: leftover.remainingSize })
  };

  // reusable_for / remaining_size のどちらも無ければ leftover_fabric 自体を載せない(schema の refine)。
  return Object.keys(value).length === 0 ? {} : { leftover_fabric: value };
}

function hasItems(value: readonly string[] | undefined): value is readonly string[] {
  return value !== undefined && value.length > 0;
}

// id = note-<date>-<slug>。同日同トピックで衝突したら -2, -3 … を付けて一意にする(id は自動生成なので、
// 衝突をエラーにせず黙って避ける)。
function uniqueNoteId(date: string, slugSource: string, existing: readonly PrototypeNote[]): string {
  const base = `note-${date}-${slugify(slugSource)}`;
  const taken = new Set(existing.map((note) => note.id));

  if (!taken.has(base)) {
    return base;
  }

  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) {
    suffix += 1;
  }

  return `${base}-${suffix}`;
}

// ascii 英数だけを残した slug。日本語など残らない場合は "note" にフォールバックする(id は date で
// 十分に一意化されるので、slug は読みやすさ用)。
function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug === "" ? "note" : slug;
}

// 試作日は作り手のカレンダー日付(ローカル)にする。toISOString の UTC 日付だと、深夜帯に前日/翌日へ
// ずれて「昨日の試作」に見えることがある。locale 非依存に local の年月日から YYYY-MM-DD を組む。
function today(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
