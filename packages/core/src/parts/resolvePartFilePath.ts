import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { isPathWithin } from "../filesystem/pathWithin.js";

// 設計判断: `files.*`(source / preview / geometry / print)の実パスを決める唯一の場所。
//
// 経緯: [paths.ts] の relativePathSchema は「project root 相対の参照パス(parts.*, profiles.*,
// outputs.dir, part.files.*)」と定義されているのに、実装は part ディレクトリ相対で解決していた。
// そのため 1 つの `.val` が part ごとのコピーに分かれ、root の原本だけを編集すると part 側が
// 黙って古いまま取り残される(PART_FILE_COPY_STALE で検出済み)。ここは schema が元から主張していた
// root 相対へ実装を寄せる。
//
// 優先順位:
//   1. `<projectRoot>/<value>` が実在すればそれ(root のファイルが原本。`loom add` のコピー元)
//   2. 無ければ `<partDir>/<value>`(コピーを持つ既存プロジェクトの後方互換)
// root を優先するので、既存プロジェクトは移行作業なしで原本を読むようになる。
//
// projectRoot を渡せない経路(`loom diff <a.loom> <b.loom>` のパス指定モードなど)は undefined を渡す。
// その場合は従来どおり part 相対だけで解決する。root を探して登る判断は呼び手の責務にする
// (ここで findProjectRoot を呼ぶと同期関数でなくなり、同期の resolvePartGeometry から使えなくなる)。
//
// 同期関数である点は意図的。createGeometryRequest の解決経路が同期(existsSync)であり、
// そこを async 化すると呼び出し連鎖全体に波及するため。
export function resolvePartFilePath(options: {
  readonly partFilePath: string;
  readonly value: string;
  // 未知(project を読まずに part.loom 単体を扱う経路)なら undefined。
  readonly projectRoot?: string;
}): string {
  const { partFilePath, value, projectRoot } = options;
  const partRelative = resolve(dirname(partFilePath), value);

  if (projectRoot === undefined) {
    return partRelative;
  }

  const rootRelative = resolve(projectRoot, value);

  // R2(境界検証): root 候補が project root 配下に収まるときだけ採用する。schema の
  // relativePathSchema が ".." と絶対パスを既に拒否しているので通常は到達しないが、schema を
  // 経由しない呼び手から root 外を指せないよう resolver 側にも置く。
  if (!isPathWithin(projectRoot, rootRelative)) {
    return partRelative;
  }

  // どちらも実在しない場合は part 相対を返す。呼び手はこのパスを ENOENT 診断の target に使うため、
  // コピーを持つ既存プロジェクトで従来と同じ場所を指し続ける(挙動を変えずに resolver を導入する)。
  return existsSync(rootRelative) ? rootRelative : partRelative;
}
