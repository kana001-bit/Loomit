import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// `{ kind: "text" }` はまだ構造化していない診断対象の置き場で、**この一覧は減る方向にしか動かない**。
//
// もともとは `createDiagnostic` の入力が string も受け、`| string` を消せば未移行がコンパイルエラーで
// 全部挙がる仕掛けだった。しかし匿名の型に書いても公開シグネチャの一部なので、あとで `| string` を
// 落とすのは「今は正しくコンパイルできている呼び出し」を壊す破壊的変更になる。**移行の都合を公開 API に
// 置かない**ことを優先し、未移行は呼び出し側で `{ kind: "text", value: … }` と書く形にした。
//
// その代わりに残件を数えるのがこのテスト。コンパイラを1つ手放した分、ここが受け持つものが2つある。
//
// 1. **残件の可視化。** 移行が進めば数が減り、一覧を書き換える一手間が「移行した」の意思表示になる。
// 2. **新しい emit 箇所が text へ逃げるのを止める。** ここが本題で、型による方法では止められなかった
//    (移行用の入口を残す限り、新しい箇所もそれを呼べてしまう)。一覧に無いファイルで text を使うと落ちる。
//
// 一覧から**消してよいのは、その箇所を本来の kind に上げたときだけ**。表示を変えずに移せる
// (`formatDiagnosticSubject` が同じ文字列を組む)ので、上げても既存の出力テストは緑のまま通る。
const TEXT_TARGET_SITES: readonly (readonly [string, number])[] = [
  // --- 自由語。プロジェクト構造上の位置を持たないので、ここは移行先が無く残り続ける ---
  ["core/src/movement-tests/rules.ts", 2], // scenario 名 / note id
  ["core/src/movement-tests/runMovementTest.ts", 1], // scenario 名

  // --- ファイルパス。`{ kind: "file" }` へ上げるのは project 相対 posix への正規化と同時にやる ---
  ["cli/src/commands/diff.ts", 4],
  ["cli/src/commands/seamlintCheck.ts", 1],
  ["core/src/build/buildProject.ts", 6],
  ["core/src/filesystem/readText.ts", 1],
  ["core/src/parts/loadPartFile.ts", 2],
  ["core/src/parts/readValSource.ts", 1],
  ["core/src/profile/loadProfile.ts", 2],
  ["core/src/project/collectProjectReadiness.ts", 4],
  ["core/src/project/createProject.ts", 3],
  ["core/src/project/findProjectRoot.ts", 2],
  ["core/src/project/findStaleGeometryExports.ts", 1],
  ["core/src/project/findStalePartFileCopies.ts", 1],
  ["core/src/project/findUnregisteredValSources.ts", 3],
  ["core/src/project/forkProject.ts", 4],
  ["core/src/project/loadProjectFile.ts", 2],
  ["core/src/prototype-notes/addPrototypeNote.ts", 4],
  ["core/src/prototype-notes/loadPrototypeNotes.ts", 2],
  ["core/src/seamlint/materializeGeometry.ts", 1],

  // --- part / connector / join / seam。構造で表せるものばかりで、ここが移行の本体 ---
  ["cli/src/commands/match.ts", 4],
  ["cli/src/commands/truerPropose.ts", 5],
  ["core/src/fit/rules.ts", 2],
  ["core/src/parts/addPartToProject.ts", 13],
  ["core/src/parts/collectEdgeOccurrencesFromVal.ts", 3],
  ["core/src/parts/connectParts.ts", 25],
  ["core/src/parts/listValDetails.ts", 3],
  ["core/src/parts/loadProjectedPart.ts", 2],
  ["core/src/parts/projectDartsFromVal.ts", 2],
  ["core/src/parts/projectNotchesFromVal.ts", 3],
  ["core/src/parts/readIncrementsFromVal.ts", 1],
  ["core/src/seamlint/createGeometryRequest.ts", 22],
  ["core/src/truer/assembleConstraintPayload.ts", 1]
];

const packagesRoot = fileURLToPath(new URL("../../..", import.meta.url));

describe("diagnostic text targets", () => {
  it("keeps the not-yet-structured targets to the recorded list", () => {
    // 守る仕様: 一覧に無いファイルで `{ kind: "text" }` を使わない。数が変わったら一覧も直す。
    expect(scanTextTargets()).toEqual(
      Object.fromEntries([...TEXT_TARGET_SITES].sort(([a], [b]) => (a < b ? -1 : 1)))
    );
  });

  it("scans the source tree it claims to scan", () => {
    // 守る仕様: 走査器そのものの健全性。対象ファイルを1つも読めていないと、上のテストは
    // 「空 == 空」で緑のまま通ってしまう(数え漏れが「移行完了」に見える)。
    const scanned = listSourceFiles();

    expect(scanned.length).toBeGreaterThan(50);
    expect(scanned).toContain("core/src/diagnostics/subject.ts");
    expect(scanned).toContain("cli/src/commands/diff.ts");
  });
});

// `packages/` 以下の .ts を、`core/src/...` のような package 相対 posix の名前で列挙する。
function listSourceFiles(): readonly string[] {
  const files: string[] = [];

  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory).sort()) {
      const fullPath = join(directory, entry);

      if (statSync(fullPath).isDirectory()) {
        walk(fullPath, `${prefix}${entry}/`);
        continue;
      }

      if (entry.endsWith(".ts")) {
        files.push(`${prefix}${entry}`);
      }
    }
  };

  for (const packageName of ["core", "cli"]) {
    walk(join(packagesRoot, packageName, "src"), `${packageName}/src/`);
  }

  return files;
}

function scanTextTargets(): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const file of listSourceFiles()) {
    const source = readFileSync(join(packagesRoot, file), "utf8");
    // 型宣言や説明コメントを数えないよう、実際に組み立てている形(`value:` を伴う)だけを数える。
    const found = source.match(/kind: "text", value:/g)?.length ?? 0;

    if (found > 0) {
      counts[file] = found;
    }
  }

  return counts;
}
