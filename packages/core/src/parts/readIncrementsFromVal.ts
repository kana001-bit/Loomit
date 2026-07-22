import { readFile } from "node:fs/promises";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { getErrno } from "../filesystem/fsError.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { collectFirstBlock, collectSelfClosingTags } from "./valXml.js";

// Valentina の <increments> に宣言される名前付きパラメータ1件。拘束 payload の params 辞書の素になる。
// value = formula 属性(宣言式)。式はここで評価しない(A案: 幾何評価は Valentina の役目)。
// name は先頭の "#" を付けたまま保持する — calculation の式では "#name" の形で参照されるため、
// 後段(occurrence の refs)がそのまま突き合わせられるようにする。
export interface ValIncrement {
  readonly name: string;
  readonly value: string;
  readonly note?: string;
}

// <increments> を read-only で読み、宣言順に列挙する。幾何にも値の評価にも触れない純関数。
export function readIncrementsFromValText(source: string): readonly ValIncrement[] {
  const block = collectFirstBlock(source, "increments");

  if (block === undefined) {
    return [];
  }

  const increments: ValIncrement[] = [];

  for (const tag of collectSelfClosingTags(block.content, "increment")) {
    const name = tag.attrs.name?.trim();

    // 名前の無い増分は params 辞書のキーにできないため対象外(壊れた .val に対する防御)。
    if (name === undefined || name.length === 0) {
      continue;
    }

    // formula 属性を持たない増分は実在する(例 #added_hips_ease = 既定 0 のツマミ)。値は空文字で表す。
    const value = tag.attrs.formula?.trim() ?? "";
    const note = tag.attrs.description?.trim();

    increments.push({
      name,
      value,
      ...(note === undefined || note.length === 0 ? {} : { note })
    });
  }

  return increments;
}

export interface ValIncrementsReadResult {
  readonly increments: readonly ValIncrement[];
  readonly diagnostics: readonly Diagnostic[];
}

// source.val が無いのは正常系(ENOENT→silent 空)。存在するのに読めない(権限等)ときだけ warning を返す。
// projectDartsFromValFile と同じ read ポリシー。
export async function readIncrementsFromValFile(
  filePath: string
): Promise<ValIncrementsReadResult> {
  let source: string;

  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    if (getErrno(error) === "ENOENT") {
      return { increments: [], diagnostics: [] };
    }

    return {
      increments: [],
      diagnostics: [
        createDiagnostic({
          severity: "warning",
          code: "PART_SOURCE_VAL_READ_FAILED",
          message:
            "source.val から increments を読み取れませんでした。 / Could not read increments from source.val.",
          target: filePath,
          suggestion: [
            "source.val の読み取り権限を確認してください。 / Check read permissions for source.val."
          ]
        })
      ]
    };
  }

  return {
    increments: readIncrementsFromValText(source),
    diagnostics: []
  };
}
