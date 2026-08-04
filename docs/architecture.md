# Loomit Architecture

この文書は、Loomit が**いま**どういう構造をしているかを書く。各節には、その形にした理由を短く添える。

役割分担:

- **この文書** — 現在の構造。何がどこにあり、なぜその形か。
- [`design-history.md`](design-history.md) — そこへ至った経緯。何を試して何が崩れたか。理由の詳細はこちらが正本。
- [`glossary.md`](glossary.md) / [`core-concepts.md`](core-concepts.md) — 用語の定義(connector の id / type / side、band seam、notch 署名)。
- [`cli.md`](cli.md) — コマンドごとの引数・フラグ・出力形式。
- `vision.md` — 何のために作っているか。

## 設計原則

Loomit は、服作りの作業ディレクトリを検証可能にするローカルファーストのツールである。

```text
Loomit core is the source of truth.
CLI is an interface.
Project files are durable state.
Check results are structured diagnostics.
Rules are small, explainable, and extensible.
Overrides are explicit, reviewable, and saved to files.
```

追加の前提:

- Loomit が管理する寸法は、縫い代を含まない仕上がり寸法である。
- 実際の裁断では、作業者が縫製方法や生地に応じて縫い代を確保する。
- `loom check` は構造とグラフを見る。長さの本当の verdict は Seamlint が持つ。
- シルエット、着用感、カーブ形状の良し悪しは、`check` ではなく `fit`、`test`、試作メモで扱う。
- UI は正本ではない。どんな操作の結果も `loomit.yml` や `part.loom` など、core が読めるファイルに保存する。

## システム境界

Loomit は CAD を置き換えない。幾何も測らない。3つのツールで分担する。

```text
Valentina (外部 CAD)
  - 型紙の作図(.val が作図ネットの正本)
  - DXF(ASTM)/ SVG / PDF の書き出し

Loomit                        ← このリポジトリ
  - 一着プロジェクトの構成管理
  - 宣言レイヤ: どのピースがどのピースと縫い合うか
  - .val からの射影(dart / notch / piece / increment)
  - assembly グラフの整合チェック
  - Seamlint / Truer への request 発行と結果集約
  - fit / movement test のルールベース診断
  - 試作メモの蓄積
  - build 出力の集約

Seamlint
  - 幾何の測定。DXF(ASTM)を読んで長さ・和・notch 位置を出す

Truer
  - 測って見つかったずれを、人が承認したぶんだけ直す(formatter)
```

> **なぜ分けたか。** 幾何を Loomit に持つと `.val` の再実装になる。Loomit は「どのピースがどう縫い合うか」の**宣言**だけを持ち、mm の測定は DXF を読む Seamlint に、線の書き換えは Truer に委ねた。経緯は design-history「責務境界が落ち着いた」。
>
> **なぜ SVG でなく DXF か。** SVG は detail identity も notch も落とす。DXF(ASTM)は BLOCK 名 = detail、縫い線 = layer 14 を保つので「どの座標を測るか」を渡せる。design-history「SVG ではなく DXF(ASTM) にたどり着いた」。

## パッケージ構成

```text
packages/
  core/                 純粋層。CLI に依存しない
    project/            loomit.yml の読み込み・解決・fork・readiness
    parts/              part.loom の読み書き、.val からの射影、connect
    schema/             Zod schema(project / part / profile / prototype-notes)
    compatibility/      loom check の互換ルール
    seamlint/           Seamlint への request 組み立てと report の解釈
    truer/              Truer への constraint payload
    diff/               part.loom の意味差分
    fit/                体型プロファイルとの比較
    movement-tests/     動作テストのルール診断
    prototype-notes/    試作メモ
    build/              出力集約と manifest
    diagnostics/        Diagnostic 型と診断コードの正本
    filesystem/         原子的書き込み・パス封じ込め・errno 分類
  cli/
    commands/           各コマンド
    formatters/         text / json 整形
```

`core` は `process` を触らず、`throw` もしない。失敗はすべて `{ ok, value | diagnostics }` の形で返す。

> **なぜ core を純粋に保つか。** report は CLI 以外(VSCode 拡張、CI、Seamlint / Truer)からも読まれる。表示や exit code を core に持ち込むと、その全部が CLI の都合に縛られる。CI は core→cli の順にビルドしてこの向きを実証している。

かつてここに `studio/` と `plugins/` を予約していたが、どちらも作らないことにした。GUI は独立アプリではなく VSCode 拡張として、既存の `loom diff --format json` と DXF を読む側に置く。plugin runtime は持たず、rule は core 内の registry に留める。

## Core の責務

`core` はドメインロジックを持つ。CLI 表示には依存しない。

- `loomit.yml` / `part.loom` / `prototype-notes.yml` / profile を読み書きする
- パーツ参照を解決する(`resolveParts`)
- `.val` から dart / notch / piece / increment を射影する
- project を fork する
- 互換チェック・fit・movement test を実行する
- Seamlint への geometry request、Truer への constraint payload を組み立てる
- `part.loom` の意味差分を出す
- build manifest を生成する
- 診断を構造化データとして返す

### `.val` の射影

`part.loom` は `.val` の**射影**であって複製ではない。Loomit は `.val` を書かない(書き込みは Valentina に委ねる)。

```text
.val (Valentina の作図ネット)
  ├── <detail> ピース      → part の files.piece / DXF の BLOCK 名
  ├── passmark             → notches[](種別・順序・位置)
  ├── dart 構成点          → darts[](頂点・脚・intake)
  └── <increment>          → 製図パラメータ(diff の draftingSource)
```

> **なぜ射影なのか。** 実データの `.val` は「1着 = 1 draw + N detail」で、detail は独立オブジェクトではなく view だった。パーツ単体をコピーする単位が Valentina のデータモデルに存在しない。だから Loomit は `.val` を正本のまま置き、diff 可能な形だけを取り出す。design-history「`.val` と `part.loom` の役割分担がはっきりした」。

## CLI の責務

CLI は core の操作をコマンドとして提供する薄い層である。

担当する: 引数の解釈、project の探索、core API の呼び出し、人間向け表示、CI 向け exit code、JSON 出力、外部ツール(`slnt` / `tru`)の subprocess 起動。

担当しない: 独自の互換チェック、独自の保存形式、core と違う判断ロジック。

境界の具体例:

```text
cli.check
  -> core.loadProject(cwd)                       ファイル読み込みと schema 検証
  -> core.resolveParts(project)                  part 参照の解決
  -> core.collectProjectReadinessDiagnostics()   part が空 / .val 未登録 / DXF が古い
  -> core.runChecks(resolvedProject)             互換ルールの実行 → CheckReport
  -> cli.formatCheckText(report) / formatCheckJson(report)
  -> exit code
```

判断はすべて core 側で終わっていて、CLI は整形と exit code だけを足す。同じ `CheckReport` を JSON で出せば CI も VSCode 拡張も同じ判断を読める。

コマンドごとの引数・フラグは [`cli.md`](cli.md) が正本。

## Durable State

Loomit の正本はファイルである。

```text
my-blouse-001/
  loomit.yml
  body.val                  ← .val は project root に置く
  parts/
    front/
      part.loom
      front.dxf             ← 測定用の幾何(files.geometry)
    back/
      part.loom
      back.dxf
  notes/
    prototype-notes.yml
  profiles/
    my-size.yml
  output/
```

`files.*` は **project root 相対を優先**して解決し、無ければ part ディレクトリ相対を見る。`loom add` は `.val` のコピーを作らない。

> **なぜ root 優先か。** 以前は part ごとに `.val` をコピーしていたが、1つの `.val` を複数 part が参照する実データでは、コピーが増えて編集が空振りする(コピーを直しても読まれない)。root を単一の実体にした。取り残されたコピーは `PART_FILE_COPY_STALE` で知らせる。

SQLite などの DB は、必要になっても検索用キャッシュとして扱う。正本はテキストファイルに置く。

## データモデル

### Project

`loomit.yml` は一着の構成を表す。

```yaml
schema: loomit.project.v0
name: my-blouse-001
garment: blouse

parts:
  front: ./parts/front/part.loom
  back: ./parts/back/part.loom
  waistband: ./parts/waistband/part.loom

profiles:
  default: ./profiles/my-size.yml

outputs:
  dir: ./output
```

`parts` のキーは **role**(project 内でのパーツの立場)で、`parts/<role>/` のディレクトリ名にもなる。

> **なぜ role と type を分けたか。** 当初は `type`(body / sleeve)を識別子にしていたが、実データには同じ type のピースが複数あり、2枚目が登録できなかった。role = project のスロット、type = garment 上の粗分類、と軸を分けた。

### Part

`part.loom` はパーツのメタデータを表す。

```yaml
schema: loomit.part.v0
name: front-panel
variant: v3
type: body
status: active

files:
  source: body.val         # 射影元の .val
  piece: front             # .val の detail 名 = DXF の BLOCK 名
  geometry: front.dxf      # 測定用(Seamlint が読む)
  preview: front.svg       # 視覚用
  print: front.pdf

measurements:
  finished:
    bust_width_mm: 480

connectors:
  outseam:                 # ← record キーが join id
    type: side
    length_mm: 806
    tolerance_mm: 3
    path_ref: FRONT        # DXF の BLOCK 名
    notch_count: 2
    side: front            # contiguous な縫い目でどちらの unit か

darts:
  waist_dart:
    apex_ref: A12
    intake_length_mm: 24
    legs: { left_ref: A13, right_ref: A14 }

notches:
  outseam_1:               # ← record キー(darts / connectors と同じ)
    seam_ref: outseam
    order: 1
    type: v

requires:
  back.outseam.length_mm:
    min: 800
    max: 812

tags: [fitted, non-stretch-fabric]
```

重要な点:

- `length_mm` は**仕上がり線上**の長さ。縫い代込みの裁断寸法ではない。
- `variant` は識別記号で、ソフトウェアの version のような大小関係を持たない。
- `requires` は version 比較ではなく、寸法・許容値・タグを直接表す。
- `status: deprecated` は手動マークで、新しい variant が出たことによる自動判定ではない。

> **なぜ variant を順序にしないか。** 縫うパーツは variant のラベルが大きいから良い、ということがない。v2 が本番で v3 が実験、はいくらでもある。design-history「version ではなく name + variant に考え直した」。

### Seam モデル

**縫い目は、共有した connector `id` を待ち合わせ点とする「参加エッジの集合」である。**

```text
connector.id     縫い目の identity。同じ id を宣言したパーツが1本の縫い目に参加する
connector.type   種類ラベル。ペアリングには使われない(同じ type の縫い目が複数あってよい)
connector.side   contiguous な縫い目で、このパーツがどちらの unit に属すか
```

1本の縫い目に参加するパーツは2枚とは限らない。

- **coincident**(`side` 無し) — 重ね。見返し・裏地・ポケットが N 枚で1本に参加し、各参加が等長。
- **contiguous**(`side` あり) — 端どうしを繋ぐ。参加ピースを**ちょうど2つの側(unit)**にまとめる。3側以上は `CONNECTOR_JOIN_TOO_MANY_SIDES`。
- **band seam** — contiguous のうち、片側がちょうど1枚(band)・反対側が複数枚(neighbours)。band の辺長が neighbours の接辺の**和**に等しい(腰帯 ↔ 前+後)。

> **なぜ id でペアにするか。** type(種類ラベル)で繋ぐと、脇の縫い目が左右に2本あるとき区別できない。id を rendezvous にし、type は分類語に降ろした。
>
> **なぜ「2枚」を捨てたか。** assembly は列ではなく tree だった。set-in sleeve の armhole は「袖1枚 ↔ 前身頃+後身頃」で、参加は3枚。「3パーツ以上 = error」は誤りと判明し、over-pair の概念を退役させた。design-history「『1本の縫い目 = 2枚』が崩れた」。

`connector` は **cross-part join 専用**である。同一パーツ内の自己シームは Loomit のモデル要素にせず、Seamlint の same-part request で表す。

### Prototype Notes

`prototype-notes.yml` は試作で得た教訓を表す。服の実体ではなく作る人の経験データなので、fork で縁を切らずコピーする。

```yaml
schema: loomit.prototype_notes.v0
notes:
  - id: note-2026-06-28-armhole
    date: 2026-06-28
    result: failed
    issue: armhole tight when raising arms
    creates_test_case: arm-raise
    applies_to: [fitted-armhole, non-stretch-fabric]
```

> **なぜ `loomit.yml` と分けたか。** 一着の構成は fork で切り離したいが、経験は持ち越したい。同じファイルに置くと両立しない。design-history「prototype notes は project state とは別物だった」。

### Body Profile

body profile は個人情報として扱い、共有・公開の対象にしない。

現在の schema は `measurements` だけを持ち、strict である(未知キーは拒否)。

```yaml
schema: loomit.profile.v0
name: my-size
base_size: 9A
measurements:
  height_cm: 160
  bust_cm: 84
  waist_cm: 66
  hip_cm: 92
  shoulder_width_cm: 38
  arm_length_cm: 54
  upper_arm_cm: 27
```

`measurements` に置くのは**体の事実**(測れば決まる値)だけである。

> **なぜ好みを混ぜないか。** 混ぜると「体に合っていない」のか「好みと違う」のかを後から分離できなくなる。`check` / `fit` / `test` を層に分けているのと同じ考え方。ただし `preferences` バケツはまだ schema に無い(下記「まだ決まっていないこと」)。

寸法名には始点と終点を含める。`yuki` のようなローマ字略称は使わない。

- `arm_length_cm` — 肩先 → 手首。
- `shoulder_width_cm` — 肩幅。

測り方の定義は寸法**名に紐づく共有リファレンス**として Loomit 側が持ち、profile ごとの自由記述にはしない。定義が人によってブレると診断が無意味になるため。

推定値を使う場合は、実測由来か推定由来かを診断の `source` に必ず明示する(explainable 原則)。

## 主要フロー

```text
作図              loom add        →  .val を part として登録(対話 or --yes)
宣言              loom connect    →  2パーツが縫い合うと宣言(band は --to)
構造チェック      loom check      →  well-formed / assembly グラフ / Seamlint request の発行可否
                  loom doctor     →  check の診断を「どう直すか」に翻訳して見せる
幾何の測定        loom slnt       →  request 組み立て → Seamlint 実行 → 結果集約
1対の突き合わせ   loom match      →  名指し2パーツの縫い目だけ測る(--reference で Truer に提案させる)
                  loom truer      →  Truer への constraint payload を書き出す
設計差分          loom diff       →  part.loom の意味差分。branch 運用の review surface
着用リスク        loom fit        →  体型プロファイルとの比較
              loom suggest-tests / loom test  →  動作テストの提案と診断
記録              loom note       →  試作メモを追記
出力              loom build      →  参照ファイルを output に集めて manifest
土台              loom init / loom fork
```

### `loom check` の3つの役割

1. **well-formed か** — schema が valid で、参照ファイルが存在するか。
2. **assembly グラフが整合しているか** — connector が対になっているか、side が2つに収まるか、unit が他の縫い目で繋がっているか。
3. **Seamlint に測定を依頼できるか** — path_ref や幾何ソースが揃っているか。

> **なぜ長さの verdict を持たないか。** `connector-length` が比較しているのは**宣言済みの `length_mm` 同士の sanity** であって、幾何ではない。宣言値は `.val` の編集に対して古くなりうる。本当の長さは DXF を測る Seamlint が出す。

### `loom diff`

`loom diff` は比較表示ではなく、**branch を残すか捨てるかを決める design review surface** である。

main から branch を切ってダーツやゆとりを変え、`loom diff` で「座標の差」ではなく「意味のある設計差分」を読む。試作が悪ければ branch を捨て、良ければ merge する。

snapshot は概念、revision は Git の handle として扱い、Loomit 独自の revision surface は持たない。

## Diagnostics

すべての診断結果は、CLI 表示ではなく構造化データを正とする。

```ts
interface Diagnostic {
  severity: "info" | "warning" | "error";
  code: DiagnosticCode;        // 語彙の正本は diagnostics/codes.ts
  message: string;             // 日本語 / English の併記
  target?: string;
  suggestion?: readonly string[];
}
```

`code` は `string` ではなく、登録済みコードの union である。新しい診断はレジストリに追記しないとコンパイルが通らない。

> **なぜ列挙するか。** 以前は 100 個以上の裸のリテラルが各モジュールに散っていて、`doctorReport` が文字列比較で発行元と繋がっていた。発行側の綴りを変えても型エラーが出ず、説明が黙って消えうる。union にすると、その暗黙のリンクがコンパイラに見える。実際、集約して初めて grep では数えられていなかった 13 個が見つかった。

CLI はこれをテキストに整形し、CI は JSON と exit code を使う。表示だけの文言差は formatter 側に置き、core の report を CLI の都合で作り替えない。report のフィールド改名は breaking change として扱う。

## Rule Architecture

互換チェックは小さな rule を順に実行する。

```ts
interface CompatibilityRule {
  id: string;
  description: string;
  appliesTo(context: RuleContext): boolean;
  check(context: RuleContext): Diagnostic[];
}
```

現行の rule: `connector-length` / `connector-pairing` / `requirement-range`。

rule は呼び出し側から注入できる(`runFit(project, profile, { rules })`)。注入された rule は `X_` 接頭辞の拡張コードを発行できる。外部 plugin runtime は持たない。

## Reuse Model

再利用は project fork による。fork 後の新 project は元から独立し、rebase / merge 的な連動はしない。prototype notes は経験データとしてコピーする。

当初は「気に入ったパーツだけを library へ publish する」経路も想定していたが撤去した。`.val` は共有作図ネットで detail が独立オブジェクトでなく view であるため、パーツ単体をコピーする単位が Valentina のデータモデルに存在しない。design-history「そして、パーツ単位の library は撤去した」。

## まだ決まっていないこと

- どの編集フィーチャまで `part.loom` に持ち上げるか
- diff の粒度をどこまで human-readable にするか
- `connector-length` を宣言メタの sanity として残すか、Seamlint への request に畳むか
- 両側とも複数枚の「和」の縫い目(現在は `SEAMLINT_CONNECTOR_SEAM_DEFERRED` で defer)
- schema marker(`loomit.part.v0`)の migration をいつ用意するか
- 試作メモを project 内(`notes/prototype-notes.yml`)に留めるか、ユーザー全体の知識ベースへ昇格させるか。昇格させる場合、fork 時にどこまでコピーするか
- profile に `preferences`(好みのバケツ)を入れるか。分離の方針は決まっているが schema はまだ `measurements` のみ
- profile の寸法追加(`neck_to_wrist_length_cm` / `elbow` / `thigh` / `rise` など)。肩幅が広い人は `arm_length_cm` が普通でも袖が短く感じるため裄丈が効くはずだが、それを消費する fit ルールと同時に入れる
