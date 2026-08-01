import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { cliDiagnosticCodes, coreDiagnosticCodes, diagnosticCodes } from "../../src/index.js";
import type { Diagnostic } from "../../src/index.js";

describe("diagnostic code registry", () => {
  it("has no duplicate codes across the core and CLI groups", () => {
    // 守る仕様: 診断コードは report JSON の語彙なので、同じ code が2箇所に登録されていない。
    // 重複していると consumer 側の分岐がどちらの意味か決められなくなる(core と CLI をまたぐ重複も含む)。
    const seen = new Set(diagnosticCodes);

    expect(seen.size).toBe(diagnosticCodes.length);
  });

  it("keeps the core and CLI groups disjoint", () => {
    // 守る仕様: core 発行と CLI 発行のコードは重ならない。発行層が一意に決まらないと、
    // 「どこを直せばこの診断が変わるか」が追えなくなる。
    const coreSet = new Set<string>(coreDiagnosticCodes);
    const overlap = cliDiagnosticCodes.filter((code) => coreSet.has(code));

    expect(overlap).toEqual([]);
  });

  it("combines both groups into the full vocabulary", () => {
    // 守る仕様: diagnosticCodes は core + CLI の全部。docs 生成や棚卸しがここだけ読めば済むようにする。
    expect(diagnosticCodes.length).toBe(coreDiagnosticCodes.length + cliDiagnosticCodes.length);
  });

  it("uses uppercase snake case for every code", () => {
    // 守る仕様: code は機械向けの安定識別子(testing-diagnostics.md の規約)。小文字・ハイフン・空白を混ぜない。
    const invalid = diagnosticCodes.filter((code) => !/^[A-Z][A-Z0-9_]*$/.test(code));

    expect(invalid).toEqual([]);
  });

  it("keeps the X_ prefix free for injected rules", () => {
    // 守る仕様: Loomit 自身のコードは X_ で始まらない。X_ は注入された rule の拡張コード用に空けてあり、
    // ここが衝突すると「Loomit の語彙か拡張か」を接頭辞で見分けられなくなる。
    const reserved = diagnosticCodes.filter((code) => code.startsWith("X_"));

    expect(reserved).toEqual([]);
  });

  it("accepts an X_ prefixed code from an injected rule", () => {
    // 守る仕様: rule 差し替えは公開 API(FitRule 等)なので、Loomit の語彙に無い診断も X_ 接頭辞で出せる。
    // レジストリを閉じた union にしたときに、この拡張点を塞いでしまわないことを型と値の両方で固定する。
    const custom: Diagnostic = {
      severity: "warning",
      code: "X_MY_RULE_NOTE",
      message: "A rule supplied by the caller reported something."
    };

    expect(custom.code).toBe("X_MY_RULE_NOTE");
  });

  it("never emits an X_ code from Loomit's own source", async () => {
    // 守る仕様: X_ は「呼び出し側の rule 由来」の印なので、Loomit 本体は X_ コードを発行しない。
    // createDiagnostic の入力型(RegisteredDiagnostic)が発行経路を型で塞いでいるが、Diagnostic を
    // 直接組み立てる書き方は型では止まらないため、src を走査して素直な抜け道を落とす。
    const offenders = await findXPrefixedCodeLiterals(srcRoots);

    expect(offenders).toEqual([]);
  });
});

const srcRoots = [
  fileURLToPath(new URL("../../src", import.meta.url)),
  fileURLToPath(new URL("../../../cli/src", import.meta.url))
];

// `code: "X_..."` の形の literal を探す。見つかった位置を "path:line" で返す(空なら違反なし)。
//
// この走査で捕まえられる範囲を明示しておく(過信しないため)。1行に `code: "X_…` と並んだ**素直な
// 直書き**だけが対象で、次は素通りする:
//   - `code:` と文字列が改行で分かれた書き方(prettier の折り返しで起こりうる)
//   - テンプレートリテラル `code: ` + バッククォート + `X_${suffix}`
//   - 変数を経由した代入(`const c = "X_FOO"; … code: c`)
//
// 完全に塞ぐには AST 解析か専用の eslint ルールが要る。ここを行単位の grep に留めているのは、
// 一次防御が型(createDiagnostic の RegisteredDiagnostic)であり、この走査はその型を迂回する
// **うっかり**を拾う二次防御だから。実際に踏んだ迂回(Diagnostic リテラルの直書き)はこの形だった。
// 迂回が巧妙になる兆候が出たら、ここを eslint ルールに格上げすること。
async function findXPrefixedCodeLiterals(roots: readonly string[]): Promise<string[]> {
  const offenders: string[] = [];

  for (const root of roots) {
    for (const filePath of await collectTypeScriptFiles(root)) {
      const source = await readFile(filePath, "utf8");

      source.split("\n").forEach((line, index) => {
        if (/\bcode:\s*"X_/.test(line)) {
          offenders.push(`${relative(root, filePath)}:${index + 1}`);
        }
      });
    }
  }

  return offenders;
}

async function collectTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(entryPath)));
      continue;
    }

    if (entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }

  return files;
}
