// .val 上の「どの型紙ピース(detail)に属するか」を読む共有規則。
//
// 1つの .val は 1着ぶんの draw と、その中の複数 detail(=Loomit の part)を持つ。射影(darts / notches)は .val 全体を
// 走査するため、そのままだと「着丸ごと」のフィーチャが全 part に付く。part ごとに自分の piece の分だけを残すため、
// 帰属を判定する側をここに集約する(darts と notches で規則が割れないように)。
//
// 帰属の在りかは2種類ある:
//   - 合印(notch): `<detail>/<nodes>` の node に直接載る。detail を辿れば piece が分かる。
//   - 内部パス(dart 等): `<draw>/<modeling>` に置かれ、detail 側が `<iPaths>/<record path="…">` で **id で名指し**する。
//     パス自体は piece を知らないので、この逆参照が唯一の帰属情報になる。
import { collectBlocks, collectFirstBlock, collectSelfClosingTags } from "./valXml.js";

// piece 名(= `<detail name>` = DXF export の BLOCK 名)の比較キー。Seamlint の BLOCK 照合
// (`blockName.trim().toUpperCase()`)に合わせて case-insensitive で見る。"Front" と "front" は同じ BLOCK に
// 解決するので、大小違いを別ピース扱いにすると part.loom の `files.piece` と .val の detail 名が一致しているのに
// 射影が空になる(= 帰属できないのに黙って空)という壊れ方をする。
export function normalizePieceKey(pieceName: string): string {
  return pieceName.trim().toLowerCase();
}

// identity として使える piece 名(= `<detail name>` が空でないもの)を宣言順に返す。
//
// **`listValDetails` の一覧と混同しないこと。** あちらは人に見せる**表示ラベル**で、名前の無い detail には
// `detail#<id>` を割り当てて一意に指せるようにしている。ラベルは代用であって .val 上の名前ではないため、帰属の
// 判定に使うと「その piece は存在する」と誤判定する ── 射影器は無名 detail を飛ばすので、射影は空のままなのに
// 「見つからない」警告も出ない、という黙り方をする。identity はここで別に数える。
export function collectPieceNames(source: string): readonly string[] {
  const names: string[] = [];

  for (const drawBlock of collectBlocks(source, "draw")) {
    const detailsBlock = collectFirstBlock(drawBlock.content, "details");

    if (detailsBlock === undefined) {
      continue;
    }

    for (const detail of collectBlocks(detailsBlock.content, "detail")) {
      const detailName = detail.attrs.name;

      // 無名 detail は突き合わせに使えない(射影器も同じ理由で飛ばす)。
      if (detailName !== undefined && detailName.trim() !== "") {
        names.push(detailName);
      }
    }
  }

  return names;
}

// piece が `<iPaths>` で名指ししている内部パス id の集合を返す。dart のように modeling 側に置かれるフィーチャの
// 帰属判定に使う。
//
// - どの detail からも名指しされないパスは **どの piece にも属さない**(集合に入らない)。Valentina 上で作ったが
//   まだどのピースにも載せていないパスがこれにあたり、射影対象から外れる。
// - 同じパスを複数 detail が載せることは妨げない(共有ダーツ)。その場合は双方の集合に入り、両 part に射影される。
// - パス id は .val 全体で一意(Valentina は id を単一カウンタで振る)なので、draw をまたいで平坦な集合にしてよい。
export function collectPieceInternalPathIds(source: string, piece: string): ReadonlySet<string> {
  const pieceKey = normalizePieceKey(piece);
  const pathIds = new Set<string>();

  for (const drawBlock of collectBlocks(source, "draw")) {
    const detailsBlock = collectFirstBlock(drawBlock.content, "details");

    if (detailsBlock === undefined) {
      continue;
    }

    for (const detail of collectBlocks(detailsBlock.content, "detail")) {
      const detailName = detail.attrs.name;

      if (detailName === undefined || normalizePieceKey(detailName) !== pieceKey) {
        continue;
      }

      const iPathsBlock = collectFirstBlock(detail.content, "iPaths");

      if (iPathsBlock === undefined) {
        continue;
      }

      // `<iPaths>` の record は `<record path="119"/>`(属性)。同じ detail の `<pins>` は `<record>120</record>`
      // (テキスト)で綴りが違うため、self-closing かつ path 属性を持つものだけを読む。
      for (const record of collectSelfClosingTags(iPathsBlock.content, "record")) {
        const pathId = record.attrs.path;

        if (pathId !== undefined && pathId !== "") {
          pathIds.add(pathId);
        }
      }
    }
  }

  return pathIds;
}
