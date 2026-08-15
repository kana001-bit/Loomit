import { describe, expect, it } from "vitest";

import { combineDiagnosticSubjects, createDiagnostic, formatDiagnosticSubject } from "../../src/index.js";
import type { DiagnosticSubject } from "../../src/index.js";

// 2026-08-13 に全 emit 箇所(createDiagnostic 110 箇所)を走査して集めた、string 時代に実際に出ていた
// target の形の一覧。**この表が移行の安全網**で、構造化した subject が同じ文字列を再現できる限り、
// テキスト出力は 1 文字も変わらない。S2 以降で emit 箇所を構造へ上げるとき、表示が変わっていないことは
// ここと各モジュールの既存テストが受け持つ。
//
// 出所を残してあるのは、あとから「この形は本当に出ていたのか」を確かめられるようにするため
// (doc の散文は 4 形式しか挙げておらず、実際は 11 種類あった)。
const LEGACY_SHAPES: readonly {
  readonly label: string;
  readonly origin: string;
  readonly subject: DiagnosticSubject;
  readonly text: string;
}[] = [
  {
    label: "ファイルパス",
    origin: "loadPartFile.ts:20 ほか最多",
    subject: { kind: "file", path: "parts/sleeve/part.loom" },
    text: "parts/sleeve/part.loom"
  },
  {
    label: "ファイルパス + フラグメント(.val の draw/seam/node)",
    origin: "projectNotchesFromVal.ts:141",
    subject: { kind: "file", path: "fixture.val", fragment: ["bodice", "hem", "60"] },
    text: "fixture.val#bodice/hem/60"
  },
  {
    label: "ファイルパス + フラグメント(piece 名のみ)",
    origin: "projectNotchesFromVal.ts:215",
    subject: { kind: "file", path: "fixture.val", fragment: ["front"] },
    text: "fixture.val#front"
  },
  {
    label: "role 単体",
    origin: "addPartToProject.ts:115",
    subject: { kind: "part", role: "front" },
    text: "front"
  },
  {
    label: "プロジェクトファイル直下の項目",
    origin: "addPartToProject.ts:171 (`parts.${role}`)",
    subject: { kind: "field", path: ["parts", "front"] },
    text: "parts.front"
  },
  {
    label: "part の上のコネクタ",
    origin: "connectParts.ts:910 (`${role}.${id}`)",
    subject: { kind: "connector", role: "sleeve", connectorId: "armhole" },
    text: "sleeve.armhole"
  },
  {
    label: "コネクタの中の項目",
    origin: "compatibility/rules.ts (`sleeve.armhole.length_mm`)",
    subject: {
      kind: "field",
      within: { kind: "connector", role: "sleeve", connectorId: "armhole" },
      path: ["length_mm"]
    },
    text: "sleeve.armhole.length_mm"
  },
  {
    label: "part の中の項目(4 セグメント)",
    origin: "fit/rules.ts:138",
    subject: {
      kind: "field",
      within: { kind: "part", role: "front" },
      path: ["measurements", "finished", "bust"]
    },
    text: "front.measurements.finished.bust"
  },
  {
    label: "join 単体",
    origin: "compatibility/rules.ts:448",
    subject: { kind: "join", joinId: "outseam" },
    text: "outseam"
  },
  {
    label: "seam(2 辺の組)",
    origin: "createGeometryRequest.ts:285 ほか (`/` 区切り)",
    subject: {
      kind: "seam",
      from: { role: "front", connectorId: "outseam" },
      to: { role: "back", connectorId: "outseam" }
    },
    text: "front.outseam/back.outseam"
  },
  {
    label: "seam(range 付き)",
    origin: "createGeometryRequest.ts:1023",
    subject: {
      kind: "seam",
      from: { role: "front", connectorId: "outseam", rangeId: "r1" },
      to: { role: "back", connectorId: "outseam", rangeId: "r1" }
    },
    text: "front.outseam.r1/back.outseam.r1"
  },
  {
    label: "対象が複数(string 時代は `, ` 結合で潰れていた)",
    origin: "compatibility/rules.ts:201, connectParts.ts:133",
    subject: {
      kind: "many",
      items: [
        { kind: "connector", role: "front", connectorId: "outseam" },
        { kind: "connector", role: "back", connectorId: "outseam" }
      ]
    },
    text: "front.outseam, back.outseam"
  },
  {
    label: "自由語(プロジェクト構造上の位置を持たない)",
    origin: "movement-tests/rules.ts:48",
    subject: { kind: "text", value: "arm-raise" },
    text: "arm-raise"
  }
];

describe("diagnostic subject", () => {
  it.each(LEGACY_SHAPES)(
    "renders $label the same as the string era ($origin)",
    ({ subject, text }) => {
      // 守る仕様: 構造化した subject の表示は、string 時代に出ていた文字列と完全に一致する。
      // ここが崩れると、既存のテキスト出力テストが一斉に落ちる形でしか気づけなくなる。
      expect(formatDiagnosticSubject(subject)).toBe(text);
    }
  );

  it("distinguishes shapes that collided as strings", () => {
    // 守る仕様: `{role}.{connectorId}` と `{joinId}.{side}` は string では**どちらも 2 セグメント**で、
    // 消費側は code を見ないと区別できなかった。同じ表示になっても構造は別物であることを固定する。
    const connector: DiagnosticSubject = {
      kind: "connector",
      role: "armhole",
      connectorId: "bodice"
    };
    const joinSide: DiagnosticSubject = {
      kind: "field",
      within: { kind: "join", joinId: "armhole" },
      path: ["bodice"]
    };

    expect(formatDiagnosticSubject(connector)).toBe("armhole.bodice");
    expect(formatDiagnosticSubject(joinSide)).toBe("armhole.bodice");
    expect(connector).not.toEqual(joinSide);
  });

  it("keeps the items of a multi-target diagnostic recoverable", () => {
    // 守る仕様: `", "` 結合が壊していたのは表示ではなく**復元可能性**。表示が同じでも、消費側が
    // 対象を 1 件ずつ取り出せることを固定する(文字列分割では戻せなかった)。
    const subject: DiagnosticSubject = {
      kind: "many",
      items: [
        { kind: "part", role: "front" },
        { kind: "field", path: ["parts", "back"] }
      ]
    };

    expect(formatDiagnosticSubject(subject)).toBe("front, parts.back");
    expect(subject.kind === "many" ? subject.items.length : 0).toBe(2);
  });

  it("renders an empty fragment as a bare path", () => {
    // 守る仕様: fragment を空配列で組んでも `path#` という壊れた表示にはしない。
    expect(formatDiagnosticSubject({ kind: "file", path: "fixture.val", fragment: [] })).toBe(
      "fixture.val"
    );
  });

  it("combines zero, one, and several subjects into distinct shapes", () => {
    // 守る仕様: 同じ意味に 2 つの形を作らない。0 件は「対象なし」(undefined)で `items: []` ではなく、
    // 1 件はその subject 自身で `{ kind: "many", items: [x] }` ではない。many は 2 件以上のときだけ。
    const front: DiagnosticSubject = { kind: "part", role: "front" };
    const back: DiagnosticSubject = { kind: "part", role: "back" };

    expect(combineDiagnosticSubjects([])).toBeUndefined();
    expect(combineDiagnosticSubjects([front])).toEqual(front);
    expect(combineDiagnosticSubjects([front, back])).toEqual({
      kind: "many",
      items: [front, back]
    });
  });

  it("omits target entirely when the diagnostic has none", () => {
    // 守る仕様: target を持たない診断に `target: undefined` というキーを生やさない
    // (JSON に「キーが無い」と「null 相当」の 2 形を作らない)。
    const diagnostic = createDiagnostic({
      severity: "warning",
      code: "PROJECT_SCHEMA_INVALID",
      message: "対象なし。 / No target."
    });

    expect(Object.hasOwn(diagnostic, "target")).toBe(false);
  });
});
