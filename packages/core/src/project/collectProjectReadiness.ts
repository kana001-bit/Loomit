import { createDiagnostic } from "../diagnostics/diagnostic.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { describeStaleAge, findStaleGeometryExports } from "./findStaleGeometryExports.js";
import { findStalePartFileCopies } from "./findStalePartFileCopies.js";
import { findUnregisteredValSources } from "./findUnregisteredValSources.js";
import type { ResolvedProject } from "./resolveParts.js";

// loom add の導入で「part を追加してからでないと意味のないコマンド」が増えた。check / build がその状況を
// 黙って ok にせず、次の一手を案内するための診断を集める。
// - part が1つも無い → error: 先に loom add する
// - parts/ 配下に、どの part の files.source にも該当しない .val がある → warning: loom add で登録する
// - part 内の files.* が project root の同名ファイルと食い違う → warning: コピーが取り残されている
// - files.geometry(DXF)が files.source(.val)より古い → warning: 書き出し直していない可能性がある
//
// 「まだ取り込まれていない .val」の定義(走査・登録済み判定・残骸判定)は findUnregisteredValSources に
// 一本化してあり、loom add の引数省略(自動発見)と同じ実装を使う(check が案内した .val を add が
// 見つけられない食い違いを構造的に防ぐ)。
//
// resolveParts / buildProject などの core プリミティブには入れない(空 project を扱うのは正当なため)。
// 「空は使い方の誤り」という判断は CLI コマンド層の方針として、この関数を明示的に呼ぶ場所にだけ効かせる。
export async function collectProjectReadinessDiagnostics(
  resolvedProject: ResolvedProject
): Promise<readonly Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const { projectFilePath } = resolvedProject.paths;

  const scan = await findUnregisteredValSources(resolvedProject);

  // 走査の失敗(error)と内容読みの降格 warning をそのまま見せる。失敗を「未登録 .val なし」に
  // 偽装しない(権限エラー等が silent に ok 扱いになるのを防ぐ)。失敗時は候補不明として扱い、
  // 判定できる診断(parts 空)だけは出す。
  diagnostics.push(...scan.diagnostics);

  const unregistered = scan.ok ? scan.value : [];

  if (Object.keys(resolvedProject.parts).length === 0) {
    const firstUnregistered = unregistered[0];

    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: "PROJECT_HAS_NO_PARTS",
        message:
          "まだ part が1つも追加されていません。 / No parts have been added to this project yet.",
        target: projectFilePath,
        suggestion: [
          firstUnregistered === undefined
            ? "Add a Valentina .val as a part first: loom add <file.val>"
            : `Add one first, e.g. loom add ${firstUnregistered.relativePath} (or just: loom add)`
        ]
      })
    );

    // part が空なら未登録 .val はすべて「まだ add していない」ものなので、error に集約する
    // (同じことを warning で重ねて出さない)。
    return diagnostics;
  }

  for (const source of unregistered) {
    diagnostics.push(
      createDiagnostic({
        severity: "warning",
        code: "UNREGISTERED_VAL_SOURCE",
        message: `未登録の .val があります: ${source.relativePath} / A .val under parts/ is not registered as a part: ${source.relativePath}`,
        target: source.path,
        suggestion:
          source.duplicateOf === undefined
            ? [`Register it as a part: loom add ${source.relativePath}`]
            : [
                `This is a copy of the already-registered ${source.duplicateOf}; delete it if it is a leftover.`
              ]
      })
    );
  }

  // part 内のコピーが project root の同名ファイルと食い違っている状態を警告する。
  //
  // files.* は root 相対を優先して解決する(resolvePartFilePath)ため、両方在れば読まれるのは root 側。
  // つまりこの警告は「古いものを読んでいる」ではなく「**このコピーは読まれない**」の通知になる。
  // 危ないのは編集の空振り(コピーを直しても効かない)と、同名の別ファイルを置いていた場合に root 側が
  // 黙って勝つこと。どちらも message で「root が読まれる」と明言することで気付けるようにする。
  const staleCopies = await findStalePartFileCopies(resolvedProject);

  // 比較できなかった事実(権限エラー等)も落とさず見せる。黙って一致扱いにすると検出自体が嘘になる。
  diagnostics.push(...staleCopies.diagnostics);

  for (const copy of staleCopies.value) {
    const pair = `${copy.copyRelativePath} ≠ ${copy.originRelativePath}`;

    diagnostics.push(
      createDiagnostic({
        severity: "warning",
        code: "PART_FILE_COPY_STALE",
        message:
          `part 内の files.${copy.field} が project root の同名ファイルと一致しません。Loomit は root 側を読むため、この part コピーは使われません: ${pair}` +
          ` / The part's files.${copy.field} does not match the same-named file at the project root. Loomit reads the project root file, so this part copy is unused: ${pair}`,
        target: copy.copyPath,
        suggestion: [
          `If ${copy.originRelativePath} is the original, delete the unused copy at ${copy.copyRelativePath}.`,
          `If the copy holds the version you want, update ${copy.originRelativePath} instead — edits to the copy have no effect.`,
          `If they are unrelated files that happen to share a name, rename one — otherwise Loomit silently reads ${copy.originRelativePath}.`
        ]
      })
    );
  }

  // `.val` を直したのに DXF を書き出し直していない状態を知らせる。放置すると `loom slnt check` が古い幾何を
  // 測って古い数値を返し、しかも失敗として表に出ない(実際に踏んだ)。
  //
  // 断定はしない: `.val` の編集が必ず幾何を動かすとは限らない(点の改名・ラベル移動なら書き出し直しても DXF は
  // 変わらない)。事実(DXF のほうが古い)と2通りの読みだけを渡す。
  const staleGeometry = await findStaleGeometryExports(resolvedProject);

  // 判定できなかった事実(権限エラー等)も落とさず見せる。
  diagnostics.push(...staleGeometry.diagnostics);

  for (const stale of staleGeometry.value) {
    const age = describeStaleAge(stale.staleByMs);
    const pair = `${stale.geometryRelativePath} < ${stale.sourceRelativePath}`;

    diagnostics.push(
      createDiagnostic({
        severity: "warning",
        code: "PART_GEOMETRY_STALE",
        message:
          `幾何ファイル(DXF)が .val より ${age} 古いままです。測定は書き出し済みの幾何に対して行われます: ${pair}` +
          ` / The geometry file (DXF) is ${age} older than the .val it is exported from. Measurements run against the exported geometry, not the .val: ${pair}`,
        target: stale.geometryPath,
        suggestion: [
          `If you changed the drafting, re-export ${stale.geometryRelativePath} from Valentina before measuring — otherwise loom slnt check reports the old geometry.`,
          `If the .val edit does not move any geometry (renaming a point, moving a label), this is expected and can be ignored.`
        ]
      })
    );
  }

  return diagnostics;
}
