import { loadPartFile } from "./loadPartFile.js";
import { projectPartDartsFromSource } from "./projectDartsFromVal.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";
import type { Part } from "../schema/part.schema.js";

// diff など darts を消費する経路向けの loader。part.loom を純粋に読んだうえで、darts を持たず
// files.source があるときだけ source.val から read-only に darts を射影する。
// 射影で出た診断(読めない・未対応形状)は成功系でも捨てず、呼び手がレポートに載せられるよう返す。
// check/build/fit はこの射影を必要としないため、素の loadPartFile を使い .val I/O を負わない。
export async function loadProjectedPart(filePath: string): Promise<LoadFileResult<Part>> {
  const loadResult = await loadPartFile(filePath);

  if (!loadResult.ok) {
    return loadResult;
  }

  const part = loadResult.value;

  if (part.darts !== undefined || part.files?.source === undefined) {
    return loadResult;
  }

  const projection = await projectPartDartsFromSource(filePath, part.files.source);
  const diagnostics = [...loadResult.diagnostics, ...projection.diagnostics];

  if (Object.keys(projection.darts).length === 0) {
    return {
      ok: true,
      value: part,
      diagnostics
    };
  }

  return {
    ok: true,
    value: {
      ...part,
      darts: projection.darts
    },
    diagnostics
  };
}
