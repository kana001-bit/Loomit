import { describe, expect, it } from "vitest";

import {
  assembleConstraintPayload,
  constraintPayloadJsonSchema,
  constraintPayloadSchema
} from "../../src/index.js";
import type { ConstraintPayloadPart } from "../../src/index.js";

// 実 emit と同じ形の最小 fixture。#shared_ease(宣言・式あり)/#default_knob(宣言・formula 無し)/#front_only(片側)/
// #pocket_opening(未宣言)＋ point/spline 両方の occurrence を含み、契約の主要バリアントを網羅する。
function twoParts(): ConstraintPayloadPart[] {
  const source = (piece: string, extra: string): string => `<pattern>
    <increments>
      <increment formula="2" name="#shared_ease"/>
      <increment name="#default_knob"/>
    </increments>
    <draw name="d">
      <calculation>
        <point id="15" length="waist_circ / 4 + #shared_ease + #default_knob${extra}" type="alongLine"/>
        <point id="2" length="rise_length" type="endLine"/>
        <point id="146" length="#pocket_opening" spline="31" type="cutSpline"/>
        <spline angle1="-45" id="31" length1="3" length2="15" point1="15" point4="2" type="simpleInteractive"/>
      </calculation>
      <modeling><point id="169" idObject="146" type="modeling"/></modeling>
      <details><detail name="${piece}"><nodes>
        <node idObject="169" passmark="true" type="NodePoint"/>
      </nodes></detail></details>
    </draw>
  </pattern>`;

  return [
    { role: "front", piece: "front", source: source("front", " + #front_only"), connectors: [{ id: "outseam" }] },
    { role: "back", piece: "back", source: source("back", ""), connectors: [{ id: "outseam" }] }
  ];
}

describe("constraint payload contract schema", () => {
  it("validates real assembleConstraintPayload output against the zod contract schema", () => {
    // 守る仕様: emitter が出す payload は契約 schema を通る。emitter と schema が drift したら parse で落ちる
    //（型は Loomit ローカルなので、この runtime 照合が Truer との契約の担保）。
    const { payload } = assembleConstraintPayload(twoParts());

    const result = constraintPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    expect(payload.schema).toBe("loomit.constraint-payload.v0");
  });

  it("rejects a payload whose param is missing the declared flag", () => {
    // 守る仕様: 契約から外れた形は schema が弾く(strict/必須)。declared を落とすと invalid になる
    //（must-not-fire の対: 上の valid ケースと合わせて schema が実際に効いていることを示す）。
    const { payload } = assembleConstraintPayload(twoParts());
    const broken = {
      ...payload,
      params: { "#x": { value: "1", usedBy: ["front"] } }
    };

    expect(constraintPayloadSchema.safeParse(broken).success).toBe(false);
  });

  it("enforces the declared/value invariant so the #3 distinction cannot re-collapse", () => {
    // 守る仕様: schema でも「未宣言 ref」と「formula 無しの宣言済みツマミ」を分ける。
    //   declared:false に value がある / declared:true に value が無い、はどちらも invalid。
    //   正しい2形（未宣言=value 無し / ツマミ=value:""）は valid。JSON Schema 経由の consumer もこの区別を信じられる。
    const envelope = (param: unknown): unknown => ({
      schema: "loomit.constraint-payload.v0",
      params: { "#x": param },
      parts: [],
      connectors: []
    });

    // 未宣言なのに value を持つ → 弾く。
    expect(constraintPayloadSchema.safeParse(envelope({ declared: false, value: "1", usedBy: ["front"] })).success).toBe(
      false
    );
    // 宣言済みなのに value が無い → 弾く。
    expect(constraintPayloadSchema.safeParse(envelope({ declared: true, usedBy: ["front"] })).success).toBe(false);
    // 正しい2形は通す。
    expect(constraintPayloadSchema.safeParse(envelope({ declared: false, usedBy: ["front"] })).success).toBe(true);
    expect(constraintPayloadSchema.safeParse(envelope({ declared: true, value: "", usedBy: ["front"] })).success).toBe(
      true
    );
  });

  it("accepts a v0 payload without notches (notches stays additive/optional)", () => {
    // 守る仕様(must-not-fire): notches は v0 に additive で足した optional フィールド。notches を持たない既存 v0 payload も
    // 契約上 valid のまま(版を上げずに後方互換を保つ)。v0 のまま必須化して旧 payload を落とす退行を防ぐ = 必須化するなら
    // schema id を v1 へ上げること。
    const legacyWithoutNotches = {
      schema: "loomit.constraint-payload.v0",
      params: {},
      parts: [{ partId: "front", piece: "front", dependsOn: [] }],
      connectors: []
    };

    expect(constraintPayloadSchema.safeParse(legacyWithoutNotches).success).toBe(true);
  });

  it("accepts a v0 payload whose connectors carry no pathRef (pathRef stays additive/optional)", () => {
    // 守る仕様(must-not-fire): pathRef は v0 に additive で足した optional フィールド。pathRef を持たない既存 v0
    // payload(この field 以前の emit / path_ref 未宣言の connector)も契約上 valid のまま。v0 のまま必須化して
    // 旧 payload を落とす退行を防ぐ = 必須化するなら schema id を v1 へ上げること。
    const legacyWithoutPathRef = {
      schema: "loomit.constraint-payload.v0",
      params: {},
      parts: [{ partId: "front", piece: "front", dependsOn: [], notches: [] }],
      connectors: [{ partId: "front", connectorId: "outseam" }]
    };

    expect(constraintPayloadSchema.safeParse(legacyWithoutPathRef).success).toBe(true);
  });

  it("rejects a connector ref with an unknown key", () => {
    // 守る仕様: connectors[] は strict。pathRef を足しても余剰キーは弾く(Truer 側 adapter の strict と対で、
    // 綴り違いの field を黙って無視して住所が落ちる事故を防ぐ)。
    const withUnknownKey = {
      schema: "loomit.constraint-payload.v0",
      params: {},
      parts: [],
      connectors: [{ partId: "front", connectorId: "outseam", blockName: "FRONT" }]
    };

    expect(constraintPayloadSchema.safeParse(withUnknownKey).success).toBe(false);
  });

  it("keeps the generated JSON Schema artifact in sync", async () => {
    // 守る仕様: zod から生成した JSON Schema が committed artifact と一致する。Truer は言語非依存にこの JSON Schema を
    // copy して validate するので、zod を変えたら artifact も更新される(drift したら落ちて再生成を促す)。
    const json = `${JSON.stringify(constraintPayloadJsonSchema(), null, 2)}\n`;
    await expect(json).toMatchFileSnapshot("../../schema/constraint-payload.v0.json");
  });
});
