import { createDiagnostic } from "../diagnostics/diagnostic.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { normalizeConnectorPathRef } from "../schema/connectorPathRef.js";
import { CONSTRAINT_PAYLOAD_SCHEMA_ID } from "../schema/constraint-payload.schema.js";
import { collectEdgeOccurrencesFromValText } from "../parts/collectEdgeOccurrencesFromVal.js";
import type { EdgeNotch } from "../parts/collectEdgeOccurrencesFromVal.js";
import { readIncrementsFromValText } from "../parts/readIncrementsFromVal.js";
import type { ValIncrement } from "../parts/readIncrementsFromVal.js";
import type { ValOccurrence } from "../parts/extractOccurrencesFromVal.js";

// 入力側の connector 1件。part.loom の `connectors` の1エントリをそのまま運ぶ。
export interface ConstraintPayloadConnector {
  readonly id: string;
  // part.loom の path_ref の**生値**(未正規化)。`svg:path#armhole` のような fragment 付きも来る。
  // 正規化(normalizeConnectorPathRef)は emit 時にこの core 側で行う ── CLI に正規化を任せると Seamlint 経路と
  // 綴りが割れうるため。宣言が無い connector は undefined(identity だけの connector は正当に存在する)。
  readonly pathRef?: string;
}

// Truer に渡す拘束 payload の入力 1 part 分(ファイル読みは呼び出し側 = CLI が済ませて渡す。core は純粋)。
export interface ConstraintPayloadPart {
  readonly role: string;
  // files.piece(= .val の detail 名)。辺の occurrence をこの piece の合印から辿る。
  // 注意: DXF BLOCK 名**そのもの**ではない(Valentina が export 時に大文字化する)。幾何ソース上の住所は
  // connector の path_ref 側にある(下記 connectors)。
  readonly piece: string;
  // files.source(.val)のテキスト。
  readonly source: string;
  // この part が宣言している connector 一覧(宣言順)。
  readonly connectors: readonly ConstraintPayloadConnector[];
}

// 変数(増分)1件。params のキーは常に増分参照 #name(インラインリテラル/measurement は occurrence.expr に載るので
// params には出さない)。
//   declared:true  → <increments> に宣言がある。value=宣言式(空文字 "" は「宣言はあるが formula 無し」= 既定0の
//                    ツマミ。#added_hips_ease 等)、note=作者コメント。
//   declared:false → 式で #name が参照されたが宣言が無い(value/note は持たない)。Truer は「動かせるツマミ」と
//                    見なさない判断ができる。Loomit は事実だけ出す(未宣言に警告はしない)。
// (旧 kind:"increment" は削除: params キーは常に増分参照で "literal" は params に出さない設計=サイズ1の
//  discriminator で情報を持たなかった。value:"" が「未宣言」と「formula 無しのツマミ」を潰していたのを分けるのが
//  本 refactor の目的。増分か否かの本当の軸は declared。)
// usedBy = **part 単位 membership**: その増分をその part の「いずれかの追跡できた seam 辺」に持つ role の集合。
// 注意: これは「その seam の両辺に出るか」ではない。connector 単位で辺を絞れない([C6])ため、多 connector part では
// seam ごとの両辺判定は与えられない(front.waist と back.inseam にしか出ない増分でも usedBy=[front,back] になりうる)。
// Truer は dependsOn + linearity + Seamlint edge で seam を絞る。
// declared で判別する union。schema(constraint-payload.schema.ts)と同じ不変条件をコンパイル時にも効かせる:
// declared:true は value 必須、declared:false は value/note を持たない。
export type ConstraintParam =
  | {
      readonly declared: true;
      // 空文字 "" = 宣言はあるが formula 無し(既定0のツマミ)。
      readonly value: string;
      readonly usedBy: readonly string[];
      readonly note?: string;
    }
  | {
      readonly declared: false;
      readonly usedBy: readonly string[];
    };

// connector は join 鍵のみ(dependsOn は持たない)。Seamlint 診断の (partId, connectorId) を引くために宣言を列挙する。
// 依存(dependsOn)は connector 単位で絞れない([C6]: connector は BLOCK 全体を指し、実際に測る辺は Seamlint が発見する)
// ため part 単位(下記 ConstraintPart)で出す。
export interface ConstraintConnectorRef {
  readonly partId: string;
  readonly connectorId: string;
  // 幾何ソース上の住所(正規化済みの path_ref)。Seamlint 診断の blockName と**綴りまで一致する**値で、Truer は
  // これで診断 → connector → part を推測なしに辿る([C10] 案A)。
  // 設計判断: 住所の権威は piece ではなく **connector** に載る。path_ref は per-connector で、幾何ソースの形式ごとに
  // 語彙が違う(DXF=BLOCK 名 / SVG=path id)。一方 parts[].piece は `.val` の detail 名で、dependsOn / notches の
  // provenance 鍵。両者は loom connect の既定で一致することが多いが、一致は保証されない(files.piece は export 前の
  // 綴り・path_ref は override 可能)ので、BLOCK 名として使ってよいのは pathRef だけ。
  // path_ref を宣言していない connector では省く(fallback を発明しない = 誤 join より欠落の方が安全)。
  // 欠落は実際に起きる: loom add の対話 scaffold は path_ref を書かない(addPartToProject の buildConnectors は
  // type/length_mm だけ)ので、loom connect 由来の connector と混在した payload になりうる。
  // ただし **pathRef 欠落 ⊇ Seamlint 未測定**: path_ref の無い connector は createGeometryRequest が
  // check を組めず(resolveGeometrySide が undefined を返し join ごと skip)、Seamlint 診断に現れない。
  // よって「診断に現れる connector は必ず pathRef を持つ」= 欠落によって取りこぼす provenance は無い。
  readonly pathRef?: string;
}

// part 単位の依存。dependsOn = その piece の合印が載るカーブ上の occurrence(その piece の全 seam が混ざる)。
// 1 piece は複数の辺(outseam/inseam/waist…)を持つが、Loomit はどの合印がどの connector かを .val から区別できない
// ため、connector ごとには分けず part 単位で1本にまとめる。
export interface ConstraintPart {
  readonly partId: string;
  readonly piece: string;
  readonly dependsOn: readonly ValOccurrence[];
  // notch 単位のグループ(applicable 用の view)。dependsOn を notch ごとに束ね直した additive な追加で、dependsOn 自体は
  // フラットのまま残す(provenance-only 消費者を壊さない)。中身は collectEdgeOccurrencesFromVal の EdgeNotch。
  // この emitter は常に emit する(空なら [])が、v0 契約 schema では optional 扱い(notches を持たない旧 v0 payload と
  // 後方互換。constraint-payload.schema.ts 参照)。
  readonly notches: readonly EdgeNotch[];
}

export interface ConstraintPayload {
  // 版付き契約識別子(constraint-payload.schema.ts)。consumer(Truer)は未知版を弾ける。契約の正本は同 schema、
  // 出力が schema を通ることは test で固定する。
  readonly schema: typeof CONSTRAINT_PAYLOAD_SCHEMA_ID;
  readonly params: Readonly<Record<string, ConstraintParam>>;
  readonly parts: readonly ConstraintPart[];
  readonly connectors: readonly ConstraintConnectorRef[];
}

export interface ConstraintPayloadResult {
  readonly payload: ConstraintPayload;
  readonly diagnostics: readonly Diagnostic[];
}

// 拘束 payload を組み立てる純関数。connector を宣言している part だけを対象にする(connector の無い part は
// どの seam にも参加しないため coupling に関与しない)。
//
// 依存は **part 単位**で出す(dependsOn は part の全 seam 混合)。connector 単位で辺を絞れない([C6])ので、
// connector 次元で provenance を狭められるフリはしない。connectors[] は join 鍵の列挙に留める。
// usedBy も part 単位 membership。Loomit は幾何 walk をせず、この事実だけ出す(2026-07-22 Kana 確定: transitive
// walk は notchless/band seam 用に defer / connector 単位分割は applicable 時に Seamlint edge と詰める = [C6])。
export function assembleConstraintPayload(
  parts: readonly ConstraintPayloadPart[]
): ConstraintPayloadResult {
  const diagnostics: Diagnostic[] = [];
  const payloadParts: ConstraintPart[] = [];
  const connectors: ConstraintConnectorRef[] = [];
  // ref(#name) → その増分を辺に持つ part.role 集合。
  const usedByRoles = new Map<string, Set<string>>();
  // 増分の宣言(value/note)。複数 part が同じ .val を共有すると同名の宣言が繰り返し来るが、それらは同一値なので
  // 最初の1件を採る。part 間で「同名だが**値(式)が食い違う**」= 別 .val に別の値を宣言している状況だけは、
  // usedBy による coupling を誤らせる(両側で同じツマミに見えて実は別物)ので警告する。
  // note(description)差だけなら coupling には効かない(幾何にも安全性にも無関係)ので発火させない=誤警告を避ける。
  const incrementByName = new Map<string, ValIncrement>();
  const conflictWarnedNames = new Set<string>();

  for (const part of parts) {
    // connector を持たない part は seam に参加しないので payload に出さない(usedBy にも数えない)。
    if (part.connectors.length === 0) {
      continue;
    }

    for (const increment of readIncrementsFromValText(part.source)) {
      const existing = incrementByName.get(increment.name);

      if (existing === undefined) {
        incrementByName.set(increment.name, increment);
      } else if (existing.value !== increment.value && !conflictWarnedNames.has(increment.name)) {
        conflictWarnedNames.add(increment.name);
        diagnostics.push(
          createDiagnostic({
            severity: "warning",
            code: "PART_CONSTRAINT_INCREMENT_CONFLICT",
            message:
              "同名の増分が part 間で異なる値(式)を宣言しています。両側で同じツマミに見えて実は別物のため coupling を誤らせます。最初の宣言を採用しました。 / The same increment is declared with a different value (formula) across parts, which would misreport coupling (it looks shared but is not). Kept the first declaration.",
            target: increment.name,
            suggestion: [
              "同じ seam を共有する part は同一の .val(同一の増分宣言)を参照しているか確認してください。 / Check that parts sharing a seam reference the same .val (the same increment declarations)."
            ]
          })
        );
      }
    }

    const edge = collectEdgeOccurrencesFromValText(part.source, { piece: part.piece });
    diagnostics.push(...edge.diagnostics);

    // membership: この part の辺が参照する増分に role を足す。
    const partRefs = new Set<string>();
    for (const occurrence of edge.occurrences) {
      for (const ref of occurrence.refs) {
        partRefs.add(ref);
      }
    }
    for (const ref of partRefs) {
      const roles = usedByRoles.get(ref) ?? new Set<string>();
      roles.add(part.role);
      usedByRoles.set(ref, roles);
    }

    // 依存は part 単位で1回だけ出す(connector ごとに複製しない = connector では絞れない [C6])。
    // notches は同じ occurrence を notch 単位に束ね直した applicable 用の view(dependsOn はフラットのまま維持)。
    payloadParts.push({
      partId: part.role,
      piece: part.piece,
      dependsOn: edge.occurrences,
      notches: edge.notches
    });

    // connector は join 鍵だけ列挙する(dependsOn は持たない)。宣言順を保つ。pathRef は Seamlint request と
    // 同じ normalize を通して出す ── 綴りが割れると Truer の join が silent に落ちるため(connectorPathRef.ts)。
    for (const connector of part.connectors) {
      connectors.push({
        partId: part.role,
        connectorId: connector.id,
        ...(connector.pathRef === undefined
          ? {}
          : { pathRef: normalizeConnectorPathRef(connector.pathRef) })
      });
    }
  }

  // params は「dependsOn が実際に参照した増分」だけを載せる(payload を辺に関係する範囲へ絞る)。
  // 参照された ref は必ず params に解決先を持つ(Truer が dependsOn.refs → params で引ける不変条件)。
  const params: Record<string, ConstraintParam> = {};
  for (const [ref, roles] of usedByRoles) {
    const declaration = incrementByName.get(ref);
    const usedBy = [...roles].sort();

    if (declaration === undefined) {
      // 未宣言: 式で参照されたが <increments> に宣言が無い。value は持たせない(「宣言値が無い」事実を "" に潰さない)。
      params[ref] = { declared: false, usedBy };
      continue;
    }

    params[ref] = {
      declared: true,
      // value="" は「宣言はあるが formula 無し(既定0のツマミ)」。未宣言(value 無し)と区別できる。
      value: declaration.value,
      usedBy,
      ...(declaration.note === undefined ? {} : { note: declaration.note })
    };
  }

  return {
    payload: { schema: CONSTRAINT_PAYLOAD_SCHEMA_ID, params, parts: payloadParts, connectors },
    diagnostics
  };
}
