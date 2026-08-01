// Valentina(.val)は XML。dart / notch など複数の射影が同じタグ走査を使うため、
// 最小限の属性・ブロック抽出ヘルパをここに集約する(各射影ファイルでの重複を避ける)。
//
// 本格的な汎用 XML パーサではないが、正規表現ではなく**文字走査のトークナイザ**で抽出する。regex 版が黙って
// 誤射影していた次の揺れに強い: コメント(`<!-- -->`)/CDATA(`<![CDATA[ ]]>`)/PI(`<? ?>`)/DOCTYPE の中身をタグと
// 誤認しない・同名タグのネストを深さで正しく閉じる・属性値の引用符内の `>` でタグが切れない・属性値は `"`/`'` の
// 両方を読む・`detail` を
// `details` の接頭辞として誤マッチしない(名前は完全一致で判定)。API(`content` はタグの生の内側文字列)は温存し、
// 呼び出し側(readIncrements / extractOccurrences / collectEdge / listValDetails / projectNotches / projectDarts)は無改修。

export interface XmlTagMatch {
  readonly attrs: Readonly<Record<string, string>>;
  readonly content: string;
}

export function collectFirstBlock(source: string, tagName: string): XmlTagMatch | undefined {
  return collectBlocks(source, tagName)[0];
}

// `<tagName …>…</tagName>` ブロックを宣言順に集める。content は開始タグの `>` 直後から対応する閉じタグ直前までの
// 生の文字列。同名ネストは深さで数えて対応閉じで切る。self-closing の同名タグはブロックにしない。閉じないまま
// source 末尾に達した開始タグは(regex 版が閉じ無しにマッチしなかったのと同じく)ブロックにしない。
export function collectBlocks(source: string, tagName: string): readonly XmlTagMatch[] {
  const tags: XmlTagMatch[] = [];
  let i = 0;

  while (i < source.length) {
    const lt = source.indexOf("<", i);
    if (lt === -1) {
      break;
    }

    const skipped = skipMarkup(source, lt);
    if (skipped !== undefined) {
      i = skipped;
      continue;
    }

    const open = readStartTag(source, lt);
    if (open === undefined) {
      // 閉じタグや不正な `<`。1 文字進めて走査を続ける(閉じタグは対応ブロック内で処理される)。
      i = lt + 1;
      continue;
    }

    if (open.name !== tagName || open.selfClosing) {
      // 別タグ、または同名でも self-closing はブロックにしない。その中身も走査対象なので content 側へ進む。
      i = open.end;
      continue;
    }

    const closeAt = findMatchingClose(source, tagName, open.end);
    if (closeAt === undefined) {
      // 閉じないまま末尾。ブロックにせず、この開始タグの後ろから別ブロックを探し続ける。
      i = open.end;
      continue;
    }

    tags.push({
      attrs: parseAttributes(open.attrs),
      content: source.slice(open.end, closeAt.start)
    });
    i = closeAt.end;
  }

  return tags;
}

// `<tagName …/>` の self-closing タグを深さに関係なく(ネストの内側も含め)宣言順に集める。content は空。
export function collectSelfClosingTags(source: string, tagName: string): readonly XmlTagMatch[] {
  const tags: XmlTagMatch[] = [];
  let i = 0;

  while (i < source.length) {
    const lt = source.indexOf("<", i);
    if (lt === -1) {
      break;
    }

    const skipped = skipMarkup(source, lt);
    if (skipped !== undefined) {
      i = skipped;
      continue;
    }

    const tag = readStartTag(source, lt);
    if (tag === undefined) {
      i = lt + 1;
      continue;
    }

    if (tag.selfClosing && tag.name === tagName) {
      tags.push({ attrs: parseAttributes(tag.attrs), content: "" });
    }

    i = tag.end;
  }

  return tags;
}

export interface XmlTagOccurrence {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
}

// タグ名を指定せず、開始タグ / self-closing タグを**出現順に全部**返す(閉じタグは含まない)。
// 「どのタグかは事前に分からないが、中身が動いたかを知りたい」用途(製図構造のフィンガープリント)向け。
// 名前を列挙して collectSelfClosingTags を並べる方式だと、.val に新しい要素が増えたときに黙って
// 取りこぼす ── この走査は「知らないものも数える」ことが目的なので、名前で絞らない。
export function collectAllTags(source: string): readonly XmlTagOccurrence[] {
  const tags: XmlTagOccurrence[] = [];
  let i = 0;

  while (i < source.length) {
    const lt = source.indexOf("<", i);
    if (lt === -1) {
      break;
    }

    const skipped = skipMarkup(source, lt);
    if (skipped !== undefined) {
      i = skipped;
      continue;
    }

    const tag = readStartTag(source, lt);
    if (tag === undefined) {
      i = lt + 1;
      continue;
    }

    tags.push({ name: tag.name, attrs: parseAttributes(tag.attrs) });
    i = tag.end;
  }

  return tags;
}

// 属性値は `"` と `'` の両方を読む(readStartTag もタグ終端判定で `'` を尊重するのと揃える)。`"` しか読まないと、
// single-quote の正当な XML で属性が丸ごと落ちる(タグは見つかるのに attrs 空 → increment 黙殺・detail#N フォールバック
// 等の誤射影を招く)。実 Valentina は `"` だが XML としては両方正当。
export function parseAttributes(source: string): Readonly<Record<string, string>> {
  const attrs: Record<string, string> = {};
  const attrPattern = /([A-Za-z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

  for (const match of source.matchAll(attrPattern)) {
    const key = match[1];
    const value = match[2] ?? match[3];

    if (key !== undefined && value !== undefined) {
      attrs[key] = value;
    }
  }

  return attrs;
}

// XML 名に使える文字(letter/digit/`_`/`-`/`.`/`:`)。名前を最長一致で読み、tagName と完全一致で判定するため、
// `detail` が `details`/`detail-foo` に誤マッチしない。
function isNameChar(ch: string): boolean {
  return (
    (ch >= "A" && ch <= "Z") ||
    (ch >= "a" && ch <= "z") ||
    (ch >= "0" && ch <= "9") ||
    ch === "_" ||
    ch === "-" ||
    ch === "." ||
    ch === ":"
  );
}

interface StartTag {
  readonly name: string;
  readonly attrs: string;
  readonly selfClosing: boolean;
  // 開始タグの `>` 直後の index。
  readonly end: number;
}

// source[start] === "<" の位置から開始/self-closing タグを読む。閉じタグ(`</`)・不正・未終端は undefined。
// 属性部は引用符(`"`/`'`)内の `>` を無視して読む(タグが引用符内の `>` で切れない)。
function readStartTag(source: string, start: number): StartTag | undefined {
  let i = start + 1;
  if (source[i] === "/" || source[i] === "!" || source[i] === "?") {
    return undefined;
  }

  const nameStart = i;
  while (i < source.length && isNameChar(source.charAt(i))) {
    i += 1;
  }
  const name = source.slice(nameStart, i);
  if (name.length === 0) {
    return undefined;
  }

  const attrsStart = i;
  let quote: string | undefined;
  while (i < source.length) {
    const ch = source.charAt(i);
    if (quote !== undefined) {
      if (ch === quote) {
        quote = undefined;
      }
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === ">") {
      const selfClosing = source[i - 1] === "/";
      const attrsEnd = selfClosing ? i - 1 : i;
      return { name, attrs: source.slice(attrsStart, attrsEnd), selfClosing, end: i + 1 };
    }
    i += 1;
  }

  return undefined;
}

// open(開始タグの `>` 直後)から、深さを数えて対応する `</tagName>` を探す。見つからなければ undefined。
function findMatchingClose(
  source: string,
  tagName: string,
  open: number
): { readonly start: number; readonly end: number } | undefined {
  let depth = 1;
  let i = open;

  while (i < source.length) {
    const lt = source.indexOf("<", i);
    if (lt === -1) {
      return undefined;
    }

    const skipped = skipMarkup(source, lt);
    if (skipped !== undefined) {
      i = skipped;
      continue;
    }

    const close = readCloseTag(source, lt);
    if (close !== undefined) {
      if (close.name === tagName) {
        depth -= 1;
        if (depth === 0) {
          return { start: lt, end: close.end };
        }
      }
      i = close.end;
      continue;
    }

    const openTag = readStartTag(source, lt);
    if (openTag === undefined) {
      i = lt + 1;
      continue;
    }
    if (openTag.name === tagName && !openTag.selfClosing) {
      depth += 1;
    }
    i = openTag.end;
  }

  return undefined;
}

// source[start] が `</name>` なら名前と `>` の直後 index を返す。
function readCloseTag(source: string, start: number): { readonly name: string; readonly end: number } | undefined {
  if (source[start] !== "<" || source[start + 1] !== "/") {
    return undefined;
  }

  let i = start + 2;
  const nameStart = i;
  while (i < source.length && isNameChar(source.charAt(i))) {
    i += 1;
  }
  const name = source.slice(nameStart, i);
  const gt = source.indexOf(">", i);
  if (gt === -1) {
    return undefined;
  }

  return { name, end: gt + 1 };
}

// source[i] がコメント/CDATA/PI/宣言(DOCTYPE 等)の開始なら、その直後の index を返す。違えば undefined。
// これらの中身にある `<tag>` をタグと誤認しないために、走査でここを丸ごと飛ばす。
function skipMarkup(source: string, i: number): number | undefined {
  if (source.startsWith("<!--", i)) {
    const end = source.indexOf("-->", i + 4);
    return end === -1 ? source.length : end + 3;
  }
  if (source.startsWith("<![CDATA[", i)) {
    const end = source.indexOf("]]>", i + 9);
    return end === -1 ? source.length : end + 3;
  }
  if (source.startsWith("<?", i)) {
    const end = source.indexOf("?>", i + 2);
    return end === -1 ? source.length : end + 2;
  }
  if (source.startsWith("<!", i)) {
    const end = source.indexOf(">", i + 2);
    return end === -1 ? source.length : end + 1;
  }
  return undefined;
}
