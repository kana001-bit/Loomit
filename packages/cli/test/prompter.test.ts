import { Readable, Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { createReadlinePrompter, EndOfInputError } from "../src/prompter.js";

// 出力は捨てる(prompt 文言はここでは検証しない)。
function sink(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    }
  });
}

// 与えた行を流し切ったら EOF になる入力ストリーム。
function inputFrom(text: string): Readable {
  return Readable.from(text);
}

describe("createReadlinePrompter EOF handling", () => {
  it("consumes buffered lines in order, then signals EOF", async () => {
    // 守る仕様: バッファ済みの行は与えた順に返し、尽きたら EOF になる。
    const prompter = createReadlinePrompter(inputFrom("first\nsecond\n"), sink());

    try {
      expect(await prompter.input("Q1")).toBe("first");
      expect(await prompter.input("Q2")).toBe("second");
    } finally {
      prompter.close();
    }
  });

  it("throws EndOfInputError for a no-default input at EOF (does not hang)", async () => {
    // 守る仕様: 入力が尽きた no-default prompt は空回答で問い直し続けず EndOfInputError を投げる。
    // これが無いと、パイプ入力が足りないときに retry ループが永久に回ってハングする。
    const prompter = createReadlinePrompter(inputFrom(""), sink());

    try {
      await expect(prompter.input("Q")).rejects.toBeInstanceOf(EndOfInputError);
    } finally {
      prompter.close();
    }
  });

  it("throws EndOfInputError for a no-default select at EOF (does not loop)", async () => {
    // 守る仕様: default の無い select は EOF で無限ループせず EndOfInputError を投げる。
    const prompter = createReadlinePrompter(inputFrom(""), sink());

    try {
      await expect(prompter.select("Q", ["a", "b"])).rejects.toBeInstanceOf(EndOfInputError);
    } finally {
      prompter.close();
    }
  });

  it("falls back to the default at EOF for input, select, and confirm", async () => {
    // 守る仕様: default を持つ prompt は EOF でもハングせず default を返す(全 default の非対話実行を壊さない)。
    const prompter = createReadlinePrompter(inputFrom(""), sink());

    try {
      expect(await prompter.input("Q", { default: "d" })).toBe("d");
      expect(await prompter.select("Q", ["a", "b"], { default: "b" })).toBe("b");
      expect(await prompter.confirm("Q", { default: true })).toBe(true);
      // confirm は default 無指定でも fallback false でハングしない。
      expect(await prompter.confirm("Q2")).toBe(false);
    } finally {
      prompter.close();
    }
  });
});
