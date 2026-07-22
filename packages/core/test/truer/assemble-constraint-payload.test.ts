import { describe, expect, it } from "vitest";

import { assembleConstraintPayload } from "../../src/index.js";
import type { ConstraintPayloadPart } from "../../src/index.js";

// front / back が outseam で縫い合う最小の2 part。両側とも spline(端点+ハンドル)に載る合印を持ち、
// #shared_ease は両側の辺に、#front_only は front の辺だけに出る。
function valWithSharedAndOneSided(options: {
  readonly extraFrontRef: string;
}): { readonly front: string; readonly back: string } {
  const increments = `<increments>
    <increment formula="2" name="#shared_ease"/>
    <increment description="front だけの調整" formula="1" name="#front_only"/>
  </increments>`;

  const front = `<pattern>
    ${increments}
    <draw name="knickers">
      <calculation>
        <point id="15" length="waist_circ / 4 + #shared_ease" type="alongLine"/>
        <point id="2" length="${options.extraFrontRef}" type="endLine"/>
        <point id="146" length="#pocket_opening" spline="31" type="cutSpline"/>
        <spline angle1="-45" angle2="90" id="31" length1="3" length2="15" point1="15" point4="2" type="simpleInteractive"/>
      </calculation>
      <modeling><point id="169" idObject="146" type="modeling"/></modeling>
      <details><detail name="front"><nodes>
        <node idObject="169" passmark="true" type="NodePoint"/>
      </nodes></detail></details>
    </draw>
  </pattern>`;

  const back = `<pattern>
    ${increments}
    <draw name="knickers">
      <calculation>
        <point id="15" length="waist_circ / 4 + #shared_ease" type="alongLine"/>
        <point id="2" length="rise_length" type="endLine"/>
        <point id="146" length="#pocket_opening" spline="31" type="cutSpline"/>
        <spline angle1="-45" angle2="90" id="31" length1="3" length2="15" point1="15" point4="2" type="simpleInteractive"/>
      </calculation>
      <modeling><point id="169" idObject="146" type="modeling"/></modeling>
      <details><detail name="back"><nodes>
        <node idObject="169" passmark="true" type="NodePoint"/>
      </nodes></detail></details>
    </draw>
  </pattern>`;

  return { front, back };
}

describe("assembleConstraintPayload", () => {
  it("computes usedBy as membership: a shared increment covers both sides, a one-sided one does not", () => {
    // 守る仕様: usedBy は「その増分を辺に持つ part 集合」。両側の辺に出る増分は両側=coupling 安全、片側だけの増分は
    // 片側=coupling 危険。coupling ラベルは Loomit が付けず、この事実(usedBy)から Truer が判定する。
    const { front, back } = valWithSharedAndOneSided({ extraFrontRef: "#front_only" });
    const parts: ConstraintPayloadPart[] = [
      { role: "front", piece: "front", source: front, connectorIds: ["outseam"] },
      { role: "back", piece: "back", source: back, connectorIds: ["outseam"] }
    ];

    const { payload, diagnostics } = assembleConstraintPayload(parts);

    expect(diagnostics).toEqual([]);
    expect(payload.params["#shared_ease"]).toEqual({
      declared: true,
      value: "2",
      usedBy: ["back", "front"]
    });
    expect(payload.params["#pocket_opening"]?.usedBy).toEqual(["back", "front"]);
    expect(payload.params["#front_only"]).toEqual({
      declared: true,
      value: "1",
      usedBy: ["front"],
      note: "front だけの調整"
    });
  });

  it("emits dependsOn per part and connectors as join keys only", () => {
    // 守る仕様: 依存は part 単位(parts[].dependsOn)で出す。connectors[] は (partId, connectorId) の join 鍵のみで
    // dependsOn を持たない(connector 単位で辺を絞れない [C6])。
    const { front, back } = valWithSharedAndOneSided({ extraFrontRef: "#front_only" });
    const { payload } = assembleConstraintPayload([
      { role: "front", piece: "front", source: front, connectorIds: ["outseam"] },
      { role: "back", piece: "back", source: back, connectorIds: ["outseam"] }
    ]);

    expect(payload.connectors).toEqual([
      { partId: "front", connectorId: "outseam" },
      { partId: "back", connectorId: "outseam" }
    ]);
    expect(payload.parts.map((part) => part.partId)).toEqual(["front", "back"]);
    const frontPart = payload.parts.find((part) => part.partId === "front");
    // front の dependsOn に #shared_ease と #front_only が現れる(端点15/2 経由)。
    const frontRefs = new Set(frontPart?.dependsOn.flatMap((occurrence) => occurrence.refs));
    expect(frontRefs.has("#shared_ease")).toBe(true);
    expect(frontRefs.has("#front_only")).toBe(true);
  });

  it("does not duplicate dependsOn across a part's multiple connectors", () => {
    // 守る仕様: 1 part が複数 connector を宣言しても dependsOn は part 単位で1本(connector ごとに複製しない)。
    // connector 次元は provenance を狭めない(過去バグ: 全 connector が同一 dependsOn を持ち connectorId が飾りになった)。
    const { front } = valWithSharedAndOneSided({ extraFrontRef: "#front_only" });
    const { payload } = assembleConstraintPayload([
      { role: "front", piece: "front", source: front, connectorIds: ["outseam", "inseam", "waist"] }
    ]);

    // parts は front 1件、connectors は3件(join 鍵)。
    expect(payload.parts.length).toBe(1);
    expect(payload.connectors).toEqual([
      { partId: "front", connectorId: "outseam" },
      { partId: "front", connectorId: "inseam" },
      { partId: "front", connectorId: "waist" }
    ]);
  });

  it("keeps every dependsOn ref resolvable in params", () => {
    // 守る仕様: dependsOn の各 ref は必ず params に解決先を持つ(Truer が dependsOn.refs → params で引ける不変条件)。
    const { front, back } = valWithSharedAndOneSided({ extraFrontRef: "#front_only" });
    const { payload } = assembleConstraintPayload([
      { role: "front", piece: "front", source: front, connectorIds: ["outseam"] },
      { role: "back", piece: "back", source: back, connectorIds: ["outseam"] }
    ]);

    for (const part of payload.parts) {
      for (const occurrence of part.dependsOn) {
        for (const ref of occurrence.refs) {
          expect(payload.params[ref]).toBeDefined();
        }
      }
    }
  });

  it("aggregates usedBy at part granularity, not per seam", () => {
    // 守る仕様: usedBy は part 単位 membership。多 connector part では「その seam の両辺」判定は与えない
    // (別 seam にしか出ない増分でも両 part に出れば usedBy=[両方] になりうる)。この事実を明示的に固定する。
    // front と back がそれぞれ2 connector を宣言し、#shared_ease は両 part の辺に出る。
    const { front, back } = valWithSharedAndOneSided({ extraFrontRef: "#front_only" });
    const { payload } = assembleConstraintPayload([
      { role: "front", piece: "front", source: front, connectorIds: ["outseam", "waist"] },
      { role: "back", piece: "back", source: back, connectorIds: ["inseam", "waist"] }
    ]);

    // usedBy は part 単位なので、どの connector 経由かに関係なく「front と back の辺に出る」= [back, front]。
    expect(payload.params["#shared_ease"]?.usedBy).toEqual(["back", "front"]);
  });

  it("skips parts that declare no connector", () => {
    // 守る仕様: connector を持たない part は seam に参加しないので parts にも connectors にも usedBy にも入れない。
    const { front } = valWithSharedAndOneSided({ extraFrontRef: "#front_only" });
    const { payload } = assembleConstraintPayload([
      { role: "front", piece: "front", source: front, connectorIds: [] }
    ]);

    expect(payload.parts).toEqual([]);
    expect(payload.connectors).toEqual([]);
    expect(payload.params).toEqual({});
  });

  const makeEaseSource = (piece: string, easeAttrs: string) => `<pattern>
      <increments><increment ${easeAttrs} name="#ease"/></increments>
      <draw name="d">
        <calculation>
          <point id="15" length="waist_circ + #ease" type="endLine"/>
          <point id="2" length="rise_length" type="endLine"/>
          <point id="146" length="1" spline="31" type="cutSpline"/>
          <spline id="31" length1="3" point1="15" point4="2" type="simpleInteractive"/>
        </calculation>
        <modeling><point id="169" idObject="146" type="modeling"/></modeling>
        <details><detail name="${piece}"><nodes>
          <node idObject="169" passmark="true" type="NodePoint"/>
        </nodes></detail></details>
      </draw>
    </pattern>`;

  it("warns when the same increment is declared with a different value (formula) across parts", () => {
    // 守る仕様: 同名増分の**値(式)**が part 間で食い違うと coupling を誤らせる(両側で同じツマミに見えて別物)ので、
    // 黙って1つへ潰さず PART_CONSTRAINT_INCREMENT_CONFLICT を出す。
    const { payload, diagnostics } = assembleConstraintPayload([
      { role: "front", piece: "front", source: makeEaseSource("front", `formula="1"`), connectorIds: ["outseam"] },
      { role: "back", piece: "back", source: makeEaseSource("back", `formula="99"`), connectorIds: ["outseam"] }
    ]);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "PART_CONSTRAINT_INCREMENT_CONFLICT"
    );
    // 潰しても最初を採るが、警告で衝突を surface する(黙って共有扱いにしない)。最初の宣言(value:"1")を採用。
    expect(payload.params["#ease"]).toEqual({ declared: true, value: "1", usedBy: ["back", "front"] });
  });

  it("does not warn when only the description differs (value is the same)", () => {
    // 守る仕様: value(式)が同じで description だけ違うのは coupling に無関係(同じツマミ)。ハザードでないので
    // PART_CONSTRAINT_INCREMENT_CONFLICT を発火させない(理由=coupling 誤り と発火条件を一致させる)。
    const { diagnostics } = assembleConstraintPayload([
      { role: "front", piece: "front", source: makeEaseSource("front", `formula="2" description="front メモ"`), connectorIds: ["outseam"] },
      { role: "back", piece: "back", source: makeEaseSource("back", `formula="2" description="back メモ"`), connectorIds: ["outseam"] }
    ]);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      "PART_CONSTRAINT_INCREMENT_CONFLICT"
    );
  });

  it("distinguishes a formula-less declared knob from an undeclared ref (both were value:'')", () => {
    // 守る仕様: value:"" に潰れていた2ケースを区別する。
    //   - 宣言はあるが formula 無し(#default_knob=既定0のツマミ): declared:true + value:""。
    //   - 式で参照されたが未宣言(#never_declared): declared:false + value を持たない。
    //     未宣言でも参照は params に残す(dependsOn.refs → params の解決先を欠かさない不変条件は維持)。
    const source = `<pattern>
      <increments><increment name="#default_knob"/></increments>
      <draw name="d">
        <calculation>
          <point id="15" length="waist_circ + #default_knob + #never_declared" type="endLine"/>
          <point id="2" length="rise_length" type="endLine"/>
          <point id="146" length="1" spline="31" type="cutSpline"/>
          <spline id="31" length1="3" point1="15" point4="2" type="simpleInteractive"/>
        </calculation>
        <modeling><point id="169" idObject="146" type="modeling"/></modeling>
        <details><detail name="front"><nodes>
          <node idObject="169" passmark="true" type="NodePoint"/>
        </nodes></detail></details>
      </draw>
    </pattern>`;

    const { payload } = assembleConstraintPayload([
      { role: "front", piece: "front", source, connectorIds: ["outseam"] }
    ]);

    // 宣言済み・formula 無し: declared:true かつ value=""(既定0のツマミ)。
    expect(payload.params["#default_knob"]).toEqual({
      declared: true,
      value: "",
      usedBy: ["front"]
    });
    // 未宣言: declared:false・value を持たないが、参照は params に残る。
    expect(payload.params["#never_declared"]).toEqual({
      declared: false,
      usedBy: ["front"]
    });
  });
});
