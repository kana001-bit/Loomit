import { describe, expect, it } from "vitest";

import { collectBlocks, collectFirstBlock, collectSelfClosingTags } from "../../src/parts/valXml.js";

// #2 Phase 1: valXml を regex からトークナイザへ差し替えた「改善」の証拠。旧 regex 版が黙って誤射影していた XML の
// 揺れを、トークナイザが正しく扱うことを pin する。実データ(golden)は挙動不変・ここは pathological ケースで差が出る所。
describe("valXml tokenizer (robust to edge cases the old regex mishandled)", () => {
  it("ignores tags inside comments", () => {
    // 守る仕様: コメント `<!-- -->` の中身はタグとして拾わない(旧 regex は ghost を拾って誤射影していた)。
    const source = `<root><!-- <point id="ghost"/> --><point id="real"/></root>`;
    expect(collectSelfClosingTags(source, "point").map((p) => p.attrs.id)).toEqual(["real"]);
  });

  it("ignores markup inside CDATA", () => {
    // 守る仕様: CDATA `<![CDATA[ ]]>` の中身はタグにしない。
    const source = `<root><![CDATA[ <point id="ghost"/> ]]><point id="real"/></root>`;
    expect(collectSelfClosingTags(source, "point").map((p) => p.attrs.id)).toEqual(["real"]);
  });

  it("closes a nested same-name block at the matching close, not the first", () => {
    // 守る仕様: 同名ネストは深さで数えて対応閉じで切る(旧 regex は最初の `</g>` で切って content を途中で落としていた)。
    const blocks = collectBlocks(`<g><g>inner</g>outer</g>`, "g");
    expect(blocks.length).toBe(1);
    expect(blocks[0]?.content).toBe(`<g>inner</g>outer`);
  });

  it("matches a tag name exactly, not as a prefix of a longer name", () => {
    // 守る仕様: `detail` を `details` の接頭辞として誤マッチしない(完全一致)。
    expect(collectFirstBlock(`<details>X</details>`, "detail")).toBeUndefined();
    expect(collectFirstBlock(`<detail>X</detail>`, "detail")?.content).toBe("X");
  });

  it("does not end a tag at a '>' inside a quoted attribute value", () => {
    // 守る仕様: 属性値の引用符内の `>` でタグが切れない(旧 regex は `[^>]*` が途中で切れて属性を丸ごと落としていた)。
    const [point] = collectSelfClosingTags(`<point label="a>b" id="1"/>`, "point");
    expect(point?.attrs).toEqual({ label: "a>b", id: "1" });
  });

  it("returns the same simple blocks as before on well-formed input", () => {
    // 守る仕様(must-not-change): 素直な入れ子はコメント等が無ければ従来どおり。content は開始タグ直後〜対応閉じ直前の生文字列。
    const draw = collectFirstBlock(`<draw><calculation><point id="1"/></calculation></draw>`, "draw");
    expect(draw?.content).toBe(`<calculation><point id="1"/></calculation>`);
  });
});
