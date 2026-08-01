// `.val` の**製図構造**が2版の間で動いたかどうかを判定する純関数。
//
// **なぜ要るか。** `loom diff` が `.val` から射影するのは darts と notches だけなので、製図式
// (`waist_circ + 2` → `+ 5` のような幾何パラメータ)を変えても差分に一切出ず `same` になる。同じ着を編集した
// のに「変更なし」と読めてしまうのが問題で、Loomit が幾何を計算しない(A案)ことの帰結ではない ── 動いたこと
// 自体は `.val` の構造から分かる。**幾何の影響量**(何 mm 動いたか)だけが Loomit の範囲外で、そちらは Seamlint。
//
// **なぜ raw テキスト比較にしないか。** Valentina は開いて保存し直すだけで大量に churn する(実測: 意味のある
// 変更1行に対し diff 246 行。`inUse` の切替 113 件、`firstToCountour`→`firstToContour` の綴り修正、grainline
// `visible`→`enabled`、`<measurements>` の要素→属性化)。raw で比べると再保存のたびに「製図が変わった」と嘘をつく。
//
// **なぜ拘束 payload の occurrence 抽出を使い回さないか。** `extractOccurrencesFromValText` は「辺の**仕上がり長**に
// 効く出現」を集めるもので、点の `angle` / `<arc>` の radius / `<operation type="moving">` を**意図的に外して**いる
// ([O-occurrence網羅] の defer)。長さに効かないだけで**幾何は動く**ため、そのまま流用すると角度や円弧を変えた編集を
// 取りこぼし、この機能の目的(「黙らない」)を果たせない。用途が違うので走査も別に持つ。
//
// **whitelist でなく denylist。** 拾う属性を列挙する方式だと、`.val` に新しい幾何属性が出たとき黙って取りこぼす。
// ここでは逆に**装飾・churn として既知のものだけを除外**し、残りは全部数える。過検出は「測ってみろ」と促すだけ
// (実害は `loom slnt check` を1回余分に回すこと)なのに対し、取りこぼしは幾何が動いたのに `same` と言う ──
// この機能が潰そうとしている失敗そのものなので、倒す向きを間違えない。
//
// **粒度は project 単位。** calculation の点をどの part(piece)のものかは Loomit には辿れない([C6])。よって
// 「この着の製図が N 箇所動いた」までを事実として出し、part への帰属は行わない。
//
// **`changes` と重なることは許容する。** `<details>` も見るので、合印を1つ足すと `changes` の
// `[added] notch …` と本フィールドの両方が動く。二重計上より「どちらかが黙る」ほうが害が大きい ── 表示側でも、
// 説明文を出すのは `changes` が空のときだけなので混乱しない。
import { createHash } from "node:crypto";

import { readIncrementsFromValText } from "../parts/readIncrementsFromVal.js";
import { collectBlocks, collectChildElements, collectFirstBlock } from "../parts/valXml.js";

// 設計判断: 「比べた結果」と「片側にしか無かった」を別の status にする。両者を
// `{ status: "changed", changedParameters: 0 }` で兼ねると、製図が動いたのか .val 自体が付いた/外れたのかを
// 区別できず、表示も同じ文面になる(「製図が動いた」と読める)。`.val` がその版に未コミットなだけのケースは
// ENOENT = 正常系で診断も出ないため、文面まで同じだと作者に嘘をつくことになる。
// 変わった属性1つ。`before` / `after` の片方が無いのは、その版に属性そのものが無かったということ。
export interface ValSourceChangedField {
  readonly attribute: string;
  readonly before?: string;
  readonly after?: string;
}

// 変わった製図要素1つ。
//
// `name` は Valentina 上の表示名(点なら "wb1"、detail なら piece 名)。**比較には使わない**(改名は幾何を
// 動かさないので IGNORED_ATTRIBUTES 側)が、`point#119` だけを見せられても作者には何のことか分からないため、
// 表示のためだけに持つ。比較に使わない値を表示に使うのは矛盾ではない ── 同一性の判定と、人への説明は別の仕事。
export interface ValSourceChange {
  readonly kind: "added" | "removed" | "modified";
  // .val 上の要素名(point / spline / arc / detail / node / increment / unit)。
  readonly tag: string;
  readonly id?: string;
  readonly name?: string;
  // 何がどう変わったか。added / removed では空にする ── 追加された点の全属性を並べても読めないので、
  // 「増えた/消えた」という事実だけを伝える。
  readonly fields: readonly ValSourceChangedField[];
}

// 比較できた2状態は件数を持ち、比較が成立しない2状態は持たない。判別可能 union にするため status は
// メンバごとに単一リテラルにしておく(`"same" | "changed"` を1メンバに畳むと絞り込みが効かない)。
export type ValSourceDiffSummary =
  | { readonly status: "same"; readonly changedParameters: number }
  | {
      readonly status: "changed";
      // 変わった製図要素の件数(追加 ＋ 削除 ＋ 属性の変更)。`changes.length` と同じ。
      readonly changedParameters: number;
      // 内訳。件数だけだと「何が動いたか」を知るのに結局 git diff を見に行くことになるので、要素単位で出す。
      readonly changes: readonly ValSourceChange[];
    }
  // 比較そのものが成立しない: 片側にしか .val が無い(= その版で付いた / 外れた)。件数は語れない。
  | { readonly status: "added" }
  | { readonly status: "removed" };

// 走査で拾った製図要素1つ。attributes は比較対象(denylist 適用済み)、name は表示専用。
interface DraftingElement {
  readonly tag: string;
  readonly id?: string;
  readonly name?: string;
  readonly attributes: ReadonlyMap<string, string>;
}

// id を持たない子要素をまとめた擬似属性の名前。XML の属性名は `#` で始まれないので実属性と衝突しない。
// 消費側(表示)はこれを特別扱いして「中身が変わった」とだけ言う ── 値は比較用のダイジェストで、人に見せても
// 意味が取れないため。
export const CONTENTS_ATTRIBUTE = "#contents";

function setAndReturn<K, V>(map: Map<K, V>, key: K, value: V): V {
  map.set(key, value);
  return value;
}

interface ElementWalkContext {
  readonly drawKey: string;
  // 現在の要素を所有する id 持ち要素のキー。id を持たない子孫はここへ畳まれる。
  readonly ownerKey: string;
  readonly parameters: Map<string, DraftingElement>;
  readonly ownedContents: Map<string, string[]>;
}

// `<draw>` の中を**深さを保って**下る。
//
// **id を持つ要素だけがエントリになる。** id を持たないのは detail の `<node>` や `<item>` のように、それ単体
// では指せない構成要素で、報告できる単位は所有者(`<detail id>` / `<path id>` / `<operation id>`)のほう。
// 出現順(`@3` のような連番)を identity にすると、先頭に1件挿入しただけで後続のキーが全部ずれ、**中身が
// 変わっていない要素まで modified として名指しする**。順序も内容の一部として畳むので、挿入も並べ替えも
// 所有者の変更1件になる。
//
// **所有者は XML 上の祖先でなければならない。** 平坦な走査(全タグを宣言順に並べ、直前の id 持ち要素を所有者と
// みなす方式)は、閉じタグが見えないので要素を抜けても所有者が親へ戻らない ── `<calculation>` 末尾の点の後に
// `<modeling>` が始まると、modeling 側の変更が**その点の変更として**報告される。実際にその誤報を出した。
function collectElements(content: string, context: ElementWalkContext): void {
  for (const child of collectChildElements(content)) {
    const id = child.attrs.id;
    const attributes = new Map<string, string>();

    for (const [rawAttribute, value] of Object.entries(child.attrs)) {
      const attribute = RENAMED_ATTRIBUTES.get(rawAttribute) ?? rawAttribute;

      if (!IGNORED_ATTRIBUTES.has(attribute)) {
        attributes.set(attribute, value);
      }
    }

    if (id === undefined || id === "") {
      // 自分の署名を所有者へ畳み、子孫も同じ所有者のまま下る(id 持ちの子孫はその子孫自身のエントリになる)。
      (
        context.ownedContents.get(context.ownerKey) ??
        setAndReturn(context.ownedContents, context.ownerKey, [])
      ).push(`${child.name}(${serializeAttributes(attributes)})`);

      collectElements(child.content, context);
      continue;
    }

    const key = `${context.drawKey}/${child.name}#${id}`;
    // id が draw 内で一意という前提が崩れても、後勝ちで**片方の変更を握りつぶさない**ように別キーへ退避する。
    let uniqueKey = key;
    let collision = 1;

    while (context.parameters.has(uniqueKey)) {
      collision += 1;
      uniqueKey = `${key}~${collision}`;
    }

    context.parameters.set(uniqueKey, {
      tag: child.name,
      id,
      // name は比較に使わない(IGNORED_ATTRIBUTES)が、表示のために生値を持っておく。
      ...(child.attrs.name === undefined || child.attrs.name === "" ? {} : { name: child.attrs.name }),
      attributes
    });

    // この要素が新しい所有者になる。
    collectElements(child.content, { ...context, ownerKey: uniqueKey });
  }
}

function serializeAttributes(attributes: ReadonlyMap<string, string>): string {
  return [...attributes]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([attribute, value]) => `${attribute}=${value}`)
    .join(" ");
}

// 内容の同一性判定だけに使う短いダイジェスト。暗号用途ではない(衝突の悪用を想定しない)が、
// 自前の弱いハッシュを書くより標準の実装に任せるほうが安全で読みやすい。
function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

// 幾何を動かさない属性。ここに挙げたものだけを無視し、残りは(知らない属性でも)数える。
//   id / uuid …… 要素の identity。値としてではなくキーとして使う(uuid は保存時に後から振られることがある)。
//   mx / my …… ラベルの表示オフセット。ラベルをドラッグしただけで動く典型的な churn。
//   name …… 点・パスの名前。改名は幾何を動かさない(式が参照していれば、その式側で捕まる)。
//   showLabel / visible / enabled / inUse …… 表示・使用フラグ。保存し直すだけで切り替わる churn
//                                            (実データで inUse は 113 件が一斉に反転していた)。
//   color / lineColor / penStyle / typeLine …… 線種と色。
const IGNORED_ATTRIBUTES: ReadonlySet<string> = new Set([
  "id",
  "uuid",
  "mx",
  "my",
  "name",
  "showLabel",
  "visible",
  "enabled",
  "inUse",
  "color",
  "lineColor",
  "penStyle",
  "typeLine"
]);

// Valentina 側で綴りが修正された属性。値は同じまま名前だけが変わるため、正規化しないと「属性が消えて別の属性が
// 生えた」= 変更として数えてしまう(実データで観測した churn)。値ベースの比較では旧綴り/新綴りを区別できないので、
// 新しい綴りへ寄せる。
const RENAMED_ATTRIBUTES: ReadonlyMap<string, string> = new Map([
  ["firstToCountour", "firstToContour"],
  ["lastToCountour", "lastToContour"]
]);

// 製図要素1つを「キー → 正規化した属性文字列」に畳む。キーは版をまたいで同じものを指せる必要がある。
//
// **`<draw>` の中を丸ごと見る**(`<calculation>` / `<modeling>` / `<details>` すべて)。当初は calculation だけを
// 見て「modeling / details の変化は loom diff 本体が扱う」としていたが**これは誤り**だった ── `diffParts` が
// 比べるのは darts / notches / connectors / requires であって、**型紙の輪郭の構成は比べない**。detail の
// `<node idObject>` を差し替えると輪郭が変わるのに、`changes` も空・`draftingSource` も same、という取りこぼしが
// できていた。「この section は誰かが見ているはず」という除外は、その誰かがいなくなると黙る穴になるので置かない。
//
// **キーは `draw の位置 / タグ / id`。** draw の**名前**は入れない ── 入れると改名だけで全キーが張り替わり、実
// fixture では 1 文字の改名が `changed (206 parameters)` になる(このモジュール自身が `name` を無視すると決めて
// いるのに draw の name だけ load-bearing、というねじれ)。一方で draw を**落として**しまうと、同じ点を draw A
// から draw B へ移した編集が同一キーのまま値も同じで `same` になる。位置(index)なら改名に強く、所属も保てる。
// `id` を持たない要素(detail の `<node>` / `<item>` など)は draw 内の出現順を identity にする。
function fingerprintValSource(source: string): ReadonlyMap<string, DraftingElement> {
  const parameters = new Map<string, DraftingElement>();

  // 単位が変われば全寸法の意味が変わる(cm→mm)。`<unit>` は draw の外なので個別に見る。
  const unit = collectFirstBlock(source, "unit");

  if (unit !== undefined) {
    parameters.set("pattern/unit", {
      tag: "unit",
      attributes: new Map([["value", unit.content.trim()]])
    });
  }

  collectBlocks(source, "draw").forEach((draw, drawIndex) => {
    const drawKey = `draw${drawIndex}`;
    // id を持たない要素の署名を、所有者(= XML 上の祖先で最も近い id 持ち要素)ごとに順序込みで貯める。
    const ownedContents = new Map<string, string[]>();

    collectElements(draw.content, {
      drawKey,
      ownerKey: drawKey,
      parameters,
      ownedContents
    });

    for (const [owner, contents] of ownedContents) {
      // id 持ちの祖先を持たない分(draw 直下の `<calculation>` など)は draw に載せる。
      const target =
        parameters.get(owner) ??
        setAndReturn(parameters, owner, { tag: "draw", attributes: new Map<string, string>() });

      // 値は「件数 + 内容のダイジェスト」。生の連結だとレポートに数 KB の文字列が載るうえ、人が読んでも
      // 意味が取れない(位置は不安定なので「何番目がどう変わったか」を見せても行動につながらない)。
      // 変わったかどうかを漏れなく判定できれば足りるので、比較可能な短い値に畳む。
      (target.attributes as Map<string, string>).set(
        CONTENTS_ATTRIBUTE,
        `${contents.length}:${digest(contents.join("|"))}`
      );
    }
  });

  for (const increment of readIncrementsFromValText(source)) {
    // 増分は名前付きのツマミで .val 全体で一意。draw 由来のキーと衝突しないよう接頭辞で分ける。
    parameters.set(`increment/${increment.name}`, {
      tag: "increment",
      name: increment.name,
      attributes: new Map([["formula", increment.value]])
    });
  }

  return parameters;
}

// 2版の `.val` 本文を比べ、製図構造が動いたかを返す。式は評価しない(文字列として比較する)ため、
// `waist_circ + 2` と `waist_circ+2` は別物として数える ── Loomit は式を解釈しない(A案)ので、同値かどうかを
// 判定できるふりをしない。
export function diffValSources(before: string, after: string): ValSourceDiffSummary {
  const beforeParameters = fingerprintValSource(before);
  const afterParameters = fingerprintValSource(after);
  const changes: ValSourceChange[] = [];

  // 並びは after の走査順(= .val の記述順)。最後に removed を足す。Map の挿入順に従うので決定的。
  for (const [key, element] of afterParameters) {
    const previous = beforeParameters.get(key);

    if (previous === undefined) {
      changes.push(describeElement("added", element));
      continue;
    }

    const fields = diffAttributes(previous.attributes, element.attributes);

    if (fields.length > 0) {
      changes.push(describeElement("modified", element, fields));
    }
  }

  for (const [key, element] of beforeParameters) {
    if (!afterParameters.has(key)) {
      changes.push(describeElement("removed", element));
    }
  }

  if (changes.length === 0) {
    return { status: "same", changedParameters: 0 };
  }

  return {
    status: "changed",
    changedParameters: changes.length,
    changes
  };
}

function describeElement(
  kind: ValSourceChange["kind"],
  element: DraftingElement,
  fields: readonly ValSourceChangedField[] = []
): ValSourceChange {
  return {
    kind,
    tag: element.tag,
    ...(element.id === undefined ? {} : { id: element.id }),
    ...(element.name === undefined ? {} : { name: element.name }),
    fields
  };
}

// 属性単位の差分。片側にしか無い属性も「消えた / 生えた」として拾う(before / after の片方が undefined)。
// 並びは属性名順にして、同じ変更が常に同じ順で出るようにする。
function diffAttributes(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>
): readonly ValSourceChangedField[] {
  const fields: ValSourceChangedField[] = [];

  for (const attribute of new Set([...before.keys(), ...after.keys()])) {
    const previous = before.get(attribute);
    const next = after.get(attribute);

    if (previous === next) {
      continue;
    }

    fields.push({
      attribute,
      ...(previous === undefined ? {} : { before: previous }),
      ...(next === undefined ? {} : { after: next })
    });
  }

  return fields.sort((a, b) => a.attribute.localeCompare(b.attribute));
}
