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
import { readIncrementsFromValText } from "../parts/readIncrementsFromVal.js";
import { collectAllTags, collectBlocks, collectFirstBlock } from "../parts/valXml.js";

// 設計判断: 「比べた結果」と「片側にしか無かった」を別の status にする。両者を
// `{ status: "changed", changedParameters: 0 }` で兼ねると、製図が動いたのか .val 自体が付いた/外れたのかを
// 区別できず、表示も同じ文面になる(「製図が動いた」と読める)。`.val` がその版に未コミットなだけのケースは
// ENOENT = 正常系で診断も出ないため、文面まで同じだと作者に嘘をつくことになる。
// 比較できた2状態は件数を持ち、比較が成立しない2状態は持たない。判別可能 union にするため status は
// メンバごとに単一リテラルにしておく(`"same" | "changed"` を1メンバに畳むと絞り込みが効かない)。
export type ValSourceDiffSummary =
  | { readonly status: "same"; readonly changedParameters: number }
  // 変わった製図要素の件数(追加 ＋ 削除 ＋ 属性の変更)。どれがどう変わったかの列挙は別スライス。
  | { readonly status: "changed"; readonly changedParameters: number }
  // 比較そのものが成立しない: 片側にしか .val が無い(= その版で付いた / 外れた)。件数は語れない。
  | { readonly status: "added" }
  | { readonly status: "removed" };

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
function fingerprintValSource(source: string): ReadonlyMap<string, string> {
  const parameters = new Map<string, string>();

  // 単位が変われば全寸法の意味が変わる(cm→mm)。`<unit>` は draw の外なので個別に見る。
  const unit = collectFirstBlock(source, "unit");

  if (unit !== undefined) {
    parameters.set("pattern/unit", unit.content.trim());
  }

  collectBlocks(source, "draw").forEach((draw, drawIndex) => {
    let anonymousIndex = 0;

    for (const tag of collectAllTags(draw.content)) {
      const id = tag.attrs.id;
      let key: string;

      if (id === undefined || id === "") {
        anonymousIndex += 1;
        key = `draw${drawIndex}/${tag.name}@${anonymousIndex}`;
      } else {
        key = `draw${drawIndex}/${tag.name}#${id}`;
      }

      const attributes = Object.entries(tag.attrs)
        .map(([attribute, value]): readonly [string, string] => [
          RENAMED_ATTRIBUTES.get(attribute) ?? attribute,
          value
        ])
        .filter(([attribute]) => !IGNORED_ATTRIBUTES.has(attribute))
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([attribute, value]) => `${attribute}=${value}`)
        .join(" ");

      // id が draw 内で一意という前提が崩れても、後勝ちで**片方の変更を握りつぶさない**ように別キーへ退避する。
      let uniqueKey = key;
      let collision = 1;

      while (parameters.has(uniqueKey)) {
        collision += 1;
        uniqueKey = `${key}~${collision}`;
      }

      parameters.set(uniqueKey, attributes);
    }
  });

  for (const increment of readIncrementsFromValText(source)) {
    // 増分は名前付きのツマミで .val 全体で一意。draw 由来のキーと衝突しないよう接頭辞で分ける。
    parameters.set(`increment/${increment.name}`, increment.value);
  }

  return parameters;
}

// 2版の `.val` 本文を比べ、製図構造が動いたかを返す。式は評価しない(文字列として比較する)ため、
// `waist_circ + 2` と `waist_circ+2` は別物として数える ── Loomit は式を解釈しない(A案)ので、同値かどうかを
// 判定できるふりをしない。
export function diffValSources(before: string, after: string): ValSourceDiffSummary {
  const beforeParameters = fingerprintValSource(before);
  const afterParameters = fingerprintValSource(after);
  let changedParameters = 0;

  for (const [key, attributes] of afterParameters) {
    const previous = beforeParameters.get(key);

    if (previous === undefined || previous !== attributes) {
      changedParameters += 1;
    }
  }

  for (const key of beforeParameters.keys()) {
    if (!afterParameters.has(key)) {
      changedParameters += 1;
    }
  }

  return {
    status: changedParameters === 0 ? "same" : "changed",
    changedParameters
  };
}
