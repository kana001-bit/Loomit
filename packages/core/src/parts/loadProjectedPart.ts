import { loadPartFile } from "./loadPartFile.js";
import { projectDartsFromValText } from "./projectDartsFromVal.js";
import { projectNotchesFromValText } from "./projectNotchesFromVal.js";
import { readValSource } from "./readValSource.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { Part } from "../schema/part.schema.js";

// diff など編集フィーチャを消費する経路向けの loader。part.loom を純粋に読んだうえで、part.loom が
// 未記載のフィーチャ(darts / notches)だけを source.val から read-only に射影する。inline で書いてあれば
// 射影しない(案A: 消費経路でも不要な .val I/O を負わない)。darts / notches は同じ source.val を消費するため
// ファイルは1回だけ読み、各フィーチャへ射影する。射影で出た診断(読めない・未対応形状)は成功系でも捨てず、
// 呼び手がレポートに載せられるよう返す。check/build/fit はこの射影を必要としないため、素の loadPartFile を
// 使い .val I/O を負わない。
export async function loadProjectedPart(filePath: string): Promise<LoadFileResult<Part>> {
  const loadResult = await loadPartFile(filePath);

  if (!loadResult.ok) {
    return loadResult;
  }

  const part = loadResult.value;
  const sourceRelative = part.files?.source;

  // 射影元(source)が無い、または darts / notches が両方 inline に載っていれば射影は不要。
  // どちらの場合も source.val I/O を負わずにそのまま返す。
  if (sourceRelative === undefined || (part.darts !== undefined && part.notches !== undefined)) {
    return loadResult;
  }

  // darts / notches は同じ source.val を消費するので、ファイルは1回だけ読んで各フィーチャへ射影する。
  const { sourceFilePath, source, diagnostics: readDiagnostics } = await readValSource(
    filePath,
    sourceRelative
  );
  const diagnostics: Diagnostic[] = [...loadResult.diagnostics, ...readDiagnostics];
  let value: Part = part;

  if (source !== undefined) {
    // inline に無いフィーチャだけを、同じ .val テキストから read-only に射影する。
    if (part.darts === undefined) {
      const projection = projectDartsFromValText(source, { filePath: sourceFilePath });
      diagnostics.push(...projection.diagnostics);

      if (Object.keys(projection.darts).length > 0) {
        value = { ...value, darts: projection.darts };
      }
    }

    if (part.notches === undefined) {
      const projection = projectNotchesFromValText(source, { filePath: sourceFilePath });
      diagnostics.push(...projection.diagnostics);

      if (Object.keys(projection.notches).length > 0) {
        value = { ...value, notches: projection.notches };
      }
    }
  }

  return {
    ok: true,
    value,
    diagnostics
  };
}
