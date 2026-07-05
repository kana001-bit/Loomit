// Valentina(.val)は XML。dart / notch など複数の射影が同じタグ走査を使うため、
// 最小限の属性・ブロック抽出ヘルパをここに集約する(各射影ファイルでの重複を避ける)。
// 本格的な XML パーサではなく、射影に必要な要素だけを正規表現で拾う軽量ユーティリティ。

export interface XmlTagMatch {
  readonly attrs: Readonly<Record<string, string>>;
  readonly content: string;
}

export function collectFirstBlock(source: string, tagName: string): XmlTagMatch | undefined {
  return collectBlocks(source, tagName)[0];
}

export function collectBlocks(source: string, tagName: string): readonly XmlTagMatch[] {
  const pattern = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, "g");
  const tags: XmlTagMatch[] = [];

  for (const match of source.matchAll(pattern)) {
    tags.push({
      attrs: parseAttributes(match[1] ?? ""),
      content: match[2] ?? ""
    });
  }

  return tags;
}

export function collectSelfClosingTags(source: string, tagName: string): readonly XmlTagMatch[] {
  const pattern = new RegExp(`<${tagName}\\b([^>]*)\\/>`, "g");
  const tags: XmlTagMatch[] = [];

  for (const match of source.matchAll(pattern)) {
    tags.push({
      attrs: parseAttributes(match[1] ?? ""),
      content: ""
    });
  }

  return tags;
}

export function parseAttributes(source: string): Readonly<Record<string, string>> {
  const attrs: Record<string, string> = {};
  const attrPattern = /([A-Za-z0-9_:-]+)\s*=\s*"([^"]*)"/g;

  for (const match of source.matchAll(attrPattern)) {
    const key = match[1];
    const value = match[2];

    if (key !== undefined && value !== undefined) {
      attrs[key] = value;
    }
  }

  return attrs;
}
