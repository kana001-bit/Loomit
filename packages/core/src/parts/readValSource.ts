import { readFile } from "node:fs/promises";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { getErrno } from "../filesystem/fsError.js";
import { resolvePartFilePath } from "./resolvePartFilePath.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";

// 設計判断: 「無い」と「読めない」を呼び手が区別できるようにする。source が undefined なだけだと、正常系
// (ENOENT = 未コミット・そもそも .val 無し)と異常系(権限等)が同じ形になり、呼び手が両者を取り違える
// ── 実際に `loom diff` が「読めなかった側」を「製図ソースが外れた = 変わった」と誤報しかけた。
export type ValSourceReadStatus = "read" | "absent" | "unreadable";

export interface ValSourceReadResult {
  // part.loom からの相対参照を解決した source.val の絶対パス。各射影の診断 target をこの実体パスへそろえる。
  readonly sourceFilePath: string;
  // 読めたときだけ入る .val テキスト。ENOENT(未コミット等)や権限エラーのときは undefined。
  readonly source?: string;
  readonly status: ValSourceReadStatus;
  readonly diagnostics: readonly Diagnostic[];
}

// part.loom から相対参照される source.val を「1回だけ」読む。darts / notches など複数の射影が同じ .val を
// 消費するため、読み込みと失敗診断をここに集約し、消費経路での重複 I/O を防ぐ。
// source.val が無いのは正常系(ENOENT→silent)。存在するのに読めない(権限等)ときだけ warning を返す。
export async function readValSource(
  partFilePath: string,
  sourceRelativePath: string,
  // project root が分かる呼び手は渡す。渡すと root の原本を優先して読む(resolvePartFilePath の優先順位)。
  // 省略時は従来どおり part 相対のみで解決する。
  projectRoot?: string
): Promise<ValSourceReadResult> {
  const sourceFilePath = resolvePartFilePath({
    partFilePath,
    value: sourceRelativePath,
    ...(projectRoot === undefined ? {} : { projectRoot })
  });

  try {
    return {
      sourceFilePath,
      source: await readFile(sourceFilePath, "utf8"),
      status: "read",
      diagnostics: []
    };
  } catch (error) {
    if (getErrno(error) === "ENOENT") {
      return { sourceFilePath, status: "absent", diagnostics: [] };
    }

    return {
      sourceFilePath,
      status: "unreadable",
      diagnostics: [
        createDiagnostic({
          severity: "warning",
          code: "PART_SOURCE_VAL_READ_FAILED",
          message: "source.val を読み取れませんでした。 / Could not read source.val.",
          target: sourceFilePath,
          suggestion: [
            "source.val の読み取り権限を確認してください。 / Check read permissions for source.val."
          ]
        })
      ]
    };
  }
}
