// part role の衝突判定。
//
// role は `parts/<role>/` というディレクトリ名であり `loomit.yml` の parts キーでもあるので、2つのピースが
// 同じ role に解決されると後から書いた方が前のものを踏む。addPartToProject は完全一致で role を登録し、
// ディレクトリ生成は FS の case 感度に従うため、「衝突するか」は綴りだけでなく置き場所の case 感度でも変わる。
// その判定を、対話 UI を持たない純関数として書き込み前に回せるようにここへ置く。
//
// 似た名前の関数が2つあるので、使い分けを先に書いておく。
//   - findCollidingRoleNames: 渡した一覧の**中だけ**で重複を見る。衝突した綴りを全て(最初に見たものも)返す。
//   - collectCollidingPieceNames: 既存 part の role(seed)とも突き合わせ、**後から来て衝突した方**だけを返す。
// 前者は「この .val に同名 detail があるか」を報告するため、後者は「どのピースに別 role を訊くか」を決めるため。

// role に使う名前のうち、role として衝突する(= 同じ parts/ ディレクトリ / loomit.yml キーに解決される)
// ものを、原文の綴りのまま初出順で返す。caseInsensitive=true のときは小文字化して比較し大文字小文字違いも
// 衝突として拾う(false=case-sensitive な Linux 等では完全一致のみ)。
//
// 衝突したときは最初に見た綴りと今の綴りの両方を返す。片方だけだとケース違いが報告から読み取れない。
export function findCollidingRoleNames(
  names: readonly string[],
  caseInsensitive: boolean
): readonly string[] {
  const firstByKey = new Map<string, string>();
  const colliding: string[] = [];

  for (const name of names) {
    const key = caseInsensitive ? name.toLowerCase() : name;
    const first = firstByKey.get(key);

    if (first === undefined) {
      firstByKey.set(key, name);
      continue;
    }

    // 衝突。最初に見た綴りと今の綴りの両方を報告に含める(ケース違いも一目で分かるように)。
    if (!colliding.includes(first)) {
      colliding.push(first);
    }
    if (!colliding.includes(name)) {
      colliding.push(name);
    }
  }

  return colliding;
}

// role 衝突するピース名を書き込み前に洗い出す。seededKeys(既存 part の role キー)と、先行するピースの
// role の両方と照合する。判定用のコピーで回すので seededKeys は破壊しない。
//
// 正規化(case 感度)は呼び出し側から normalizeRoleKey として注入する。実 FS の case 感度は置き場所ごとに
// 違い、それを測るのは I/O なので、純粋な判定の中では読まない(isCaseInsensitiveFileSystemAt で先に測る)。
//
// findCollidingRoleNames と違い、返すのは**後から来て衝突した方**だけ。「この名前には別 role を訊く」という
// next action にそのまま対応させるため、先に居た方(そのまま使える)は含めない。
export function collectCollidingPieceNames(
  pieceNames: readonly string[],
  seededKeys: ReadonlySet<string>,
  normalizeRoleKey: (role: string) => string
): readonly string[] {
  const simulated = new Set(seededKeys);
  const colliding: string[] = [];

  for (const pieceName of pieceNames) {
    const key = normalizeRoleKey(pieceName);

    if (simulated.has(key)) {
      colliding.push(pieceName);
    } else {
      simulated.add(key);
    }
  }

  return colliding;
}
