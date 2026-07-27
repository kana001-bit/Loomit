import { createDiagnostic } from "../diagnostics/diagnostic.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { findStalePartFileCopies } from "./findStalePartFileCopies.js";
import type { CopiedFileField } from "./findStalePartFileCopies.js";
import { findUnregisteredValSources } from "./findUnregisteredValSources.js";
import type { ResolvedProject } from "./resolveParts.js";

// loom add の導入で「part を追加してからでないと意味のないコマンド」が増えた。check / build がその状況を
// 黙って ok にせず、次の一手を案内するための診断を集める。
// - part が1つも無い → error: 先に loom add する
// - parts/ 配下に、どの part の files.source にも該当しない .val がある → warning: loom add で登録する
// - part 内の files.* が project root の同名ファイルと食い違う → warning: コピーが取り残されている
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

  // part 内のコピーが project root の原本と食い違っている状態を警告する。射影(darts / notches)と
  // Seamlint 測定は part 側コピーを読むため、古いコピーは「失敗」ではなく「静かに間違った結果」になる。
  const staleCopies = await findStalePartFileCopies(resolvedProject);

  // 比較できなかった事実(権限エラー等)も落とさず見せる。黙って一致扱いにすると検出自体が嘘になる。
  diagnostics.push(...staleCopies.diagnostics);

  for (const copy of staleCopies.value) {
    const impact = describeStaleImpact(copy.field);
    const pair = `${copy.copyRelativePath} ≠ ${copy.originRelativePath}`;

    diagnostics.push(
      createDiagnostic({
        severity: "warning",
        code: "PART_FILE_COPY_STALE",
        message:
          `part 内の files.${copy.field} が project root の同名ファイルと一致しません${impact.ja}: ${pair}` +
          ` / The part's files.${copy.field} does not match the same-named file at the project root${impact.en}: ${pair}`,
        target: copy.copyPath,
        suggestion: [
          `If ${copy.originRelativePath} is the original, copy it over ${copy.copyRelativePath}.`,
          "If they are unrelated files that happen to share a name, rename one so the copy relationship is unambiguous."
        ]
      })
    );
  }

  return diagnostics;
}

// 古いコピーが何を汚すかはフィールドごとに違う。影響のあるフィールドだけ結果への波及を message に添え、
// 「直さなくてよい警告」と誤解されるのを防ぐ。print は出力用 artifact なので check / diff への波及はない。
function describeStaleImpact(field: CopiedFileField): {
  readonly ja: string;
  readonly en: string;
} {
  switch (field) {
    case "source":
      return {
        ja: "(loom diff が古い .val から darts / notches を射影します)",
        en: " (loom diff will project darts / notches from the stale .val)"
      };
    case "preview":
    case "geometry":
      return {
        ja: "(Seamlint が古い幾何を測ります)",
        en: " (Seamlint will measure the stale geometry)"
      };
    case "print":
      return { ja: "", en: "" };
  }
}
