import { loadPartFile } from "./loadPartFile.js";
import { projectDartsFromValText } from "./projectDartsFromVal.js";
import { projectNotchesFromValText } from "./projectNotchesFromVal.js";
import { readValSource } from "./readValSource.js";
import { findProjectRoot } from "../project/findProjectRoot.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { Part } from "../schema/part.schema.js";

// diff など編集フィーチャを消費する経路向けの loader。part.loom を純粋に読んだうえで、part.loom が
// 未記載のフィーチャ(darts / notches)だけを source.val から read-only に射影する。inline で書いてあれば
// 射影しない(案A: 消費経路でも不要な .val I/O を負わない)。darts / notches は同じ source.val を消費するため
// ファイルは1回だけ読み、各フィーチャへ射影する。射影で出た診断(読めない・未対応形状)は成功系でも捨てず、
// 呼び手がレポートに載せられるよう返す。check/build/fit はこの射影を必要としないため、素の loadPartFile を
// 使い .val I/O を負わない。
export async function loadProjectedPart(
  filePath: string,
  // project を既に読んでいる呼び手は projectRoot を渡す。省略時はこの関数が part.loom から登って探す。
  options?: { readonly projectRoot?: string }
): Promise<LoadFileResult<Part>> {
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

  // source の解決は project root 相対を優先する(resolvePartFilePath)。root が分からないと part 内の
  // 古いコピーを読んでしまうため、呼び手が渡さない場合はここで part.loom から登って探す
  // (失敗の扱いは resolveProjectRoot のコメントを参照)。
  const rootLookup: ProjectRootLookup =
    options?.projectRoot === undefined
      ? await resolveProjectRoot(filePath)
      : { projectRoot: options.projectRoot, diagnostics: [] };

  // darts / notches は同じ source.val を消費するので、ファイルは1回だけ読んで各フィーチャへ射影する。
  const { sourceFilePath, source, diagnostics: readDiagnostics } = await readValSource(
    filePath,
    sourceRelative,
    rootLookup.projectRoot
  );
  const diagnostics: Diagnostic[] = [
    ...loadResult.diagnostics,
    ...rootLookup.diagnostics,
    ...readDiagnostics
  ];
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

interface ProjectRootLookup {
  readonly projectRoot?: string;
  readonly diagnostics: readonly Diagnostic[];
}

// part.loom から loomit.yml を探して project root を返す。2種類の失敗を区別する:
//
// - 見つからない(PROJECT_ROOT_NOT_FOUND): 正常系。orphan な part.loom を2つ直接比べる
//   `loom diff <a.loom> <b.loom>` が正当な使い方なので、診断を出さず part 相対にフォールバックする。
// - 読めない(権限エラー等): 握りつぶさない(R3)。undefined に畳むと「project の外」と区別が付かなくなり、
//   part 内の古いコピーから黙って射影したうえで正しい差分として報告してしまう ── このブランチが
//   潰そうとしている失敗そのものを、エラー経路から再導入することになる。errno 分類済みの診断を
//   warning に降格して surface し、射影自体は part 相対で続行する。
async function resolveProjectRoot(partFilePath: string): Promise<ProjectRootLookup> {
  const found = await findProjectRoot(partFilePath);

  if (found.ok) {
    return { projectRoot: found.value, diagnostics: [] };
  }

  return {
    diagnostics: found.diagnostics
      .filter((diagnostic) => diagnostic.code !== "PROJECT_ROOT_NOT_FOUND")
      .map((diagnostic) => ({ ...diagnostic, severity: "warning" as const }))
  };
}
