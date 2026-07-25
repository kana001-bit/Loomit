# Loomit Architecture v0

この文書は、Loomit の実装に入る前のアーキテクチャ設計ドラフトである。

`vision.md` は思想、`technical-plan.md` は実装計画、`architecture-references.md` は参考モデルを扱う。この文書では、それらをつないで、core、CLI、Studio、ファイル形式、ライブラリ、試作メモの責務分担を定義する。

## 設計原則

Loomit は、服作りの作業ディレクトリを検証可能にするローカルファーストのツールである。

```text
Loomit core is the source of truth.
CLI and Studio are interfaces.
Project files are durable state.
Check results are structured diagnostics.
Rules are small, explainable, and extensible.
Overrides are explicit, reviewable, and saved to files.
Studio actions must be reproducible by CLI.
```

追加の前提:

- Loomit が管理する寸法は、縫い代を含まない仕上がり寸法である。
- 実際の裁断では、作業者が縫製方法や生地に応じて縫い代を確保する。
- `loom check` は、まず「仕上がり線同士が縫い合わせ可能か」を検証する。
- シルエット、着用感、カーブ形状の良し悪しは、`check` ではなく `fit`、`test`、試作メモで扱う。
- UI は正本ではない。Studio の操作結果も `loomit.yml` や `part.loom` など、core が読めるファイルに保存する。

## システム境界

Loomit は本格的な CAD を置き換えない。

```text
External CAD
  - 型紙作成
  - 細かな図形編集
  - SVG/PDF/DXF などの出力

Loomit
  - 一着プロジェクトの構成管理
  - パーツメタデータ管理
  - 仕上がり寸法ベースの互換チェック
  - fit / movement test のルールベース診断
  - 試作メモの蓄積
  - build 出力の集約

Loomit Studio
  - 視覚的な選択とデバッグ
  - SVG/PDF プレビュー
  - connector / tolerance / gather range の編集支援
  - check / fit / test 結果の可視化
```

## パッケージ構成

v0 の想定構成:

```text
packages/
  core/
    project/
    parts/
    compatibility/
    prototype-notes/
    fit/
    movement-tests/
    build/
    diagnostics/
  cli/
    commands/
      init.ts
      fork.ts
      check.ts
      doctor.ts
      fit.ts
      suggest-tests.ts
      test.ts
      build.ts
  studio/
    app/
  plugins/
    importers/
    exporters/
    rules/
```

`plugins/` と `studio/` は最初から完成させない。core の境界を壊さないための置き場所として先に名前を決めておく。

## Core の責務

`core` は Loomit のドメインロジックを持つ。CLI 表示や Studio 表示には依存しない。

主な責務:

- `loomit.yml` を読み書きする
- `part.loom` を読み書きする
- パーツ参照を解決する
- project fork を実行する
- 互換チェックを実行する
- fit check を実行する
- movement test を実行する
- test suggestion を生成する
- build manifest を生成する
- diagnostics を構造化データとして返す

想定 API:

```ts
loadProject(path): Project
saveProject(project): void
createProject(path, options): Project
forkProject(sourcePath, targetPath, options): Project
resolveParts(project): ResolvedProject
runChecks(project): CheckReport
runDoctor(project): DoctorReport
runFit(project, profile): FitReport
suggestTests(project, profile): TestSuggestionReport
runMovementTest(project, profile, scenario): MovementTestReport
runTestSuite(project, profile, suite): TestSuiteReport
buildProject(project): BuildResult
```

## CLI の責務

CLI は core の操作をコマンドとして提供する。

CLI は次を担当する:

- 引数を解釈する
- カレントディレクトリから project を見つける
- core API を呼ぶ
- diagnostics を人間向けに表示する
- CI 向けに exit code を返す
- 必要に応じて JSON を出力する

CLI は次を担当しない:

- 独自の互換チェック
- 独自の project 保存形式
- Studio と違う判断ロジック

## Studio の責務

Studio は core の上に乗る補助 UI である。

Studio が持つ責務:

- プロジェクト作成 UI
- パーツ選択
- SVG/PDF プレビュー
- connector の視覚指定
- gather range の指定
- tolerance の編集
- intentionally unsewn edge の指定
- `loom check` 結果の可視化
- `loom fit` 結果の可視化
- `loom suggest-tests` 結果の確認
- test suite の採用/除外と reason 入力

Studio が持たない責務:

- core と別の互換チェック実装
- core と別の保存形式
- CLI で再現できない内部状態

Studio の編集操作は、最終的に core の command model を通してファイルに保存する。

```ts
setConnectorTolerance(project, "body.armhole", 12, {
  reason: "gathered sleeve cap"
});

markConnectorUnsewn(project, "body.side_seam", {
  reason: "side seam is intentionally left open"
});
```

## Durable State

Loomit の正本はファイルである。

```text
my-blouse-001/
  loomit.yml
  parts/
    body/
      part.loom
      source.val
      preview.svg
    sleeve/
      part.loom
      source.val
      preview.svg
  notes/
    prototype-notes.yml
  profiles/
    my-size.yml
  output/
```

SQLite などの DB は、必要になった場合も検索用キャッシュまたはインデックスとして扱う。正本は `loomit.yml`、`part.loom`、`prototype-notes.yml` などのテキストファイルに置く。

## データモデル

### Project

`loomit.yml` は一着の構成を表す。

```yaml
schema: loomit.project.v0
name: my-blouse-001
garment: blouse

parts:
  body: ./parts/body/part.loom
  sleeve: ./parts/sleeve/part.loom
  collar: ./parts/collar/part.loom
  cuff: ./parts/cuff/part.loom

profiles:
  default: ./profiles/my-size.yml

test_suite:
  required:
    - arm-raise
    - reach-forward
  ignored:
    squat:
      reason: blouse, not relevant

outputs:
  dir: ./output
```

`parts` は現在の一着で使うパーツを指す。

### Part

`part.loom` はパーツのメタデータを表す。

```yaml
schema: loomit.part.v0
name: puff-sleeve
variant: v3
type: sleeve
status: active

files:
  source: source.val
  preview: preview.svg
  print: print.pdf

measurements:
  finished:
    bicep_width_mm: 320
    sleeve_length_mm: 540

connectors:
  armhole:
    type: armhole
    length_mm: 469
    tolerance_mm: 3
    path_ref: svg:path#armhole
    ranges:
      - id: sleeve-cap-gather
        from: 0.18
        to: 0.72
        behavior: gathered
        allowance_mm: 18

requires:
  body.armhole.length_mm:
    min: 466
    max: 472

tags:
  - puff
  - gathered
  - fitted-armhole
```

重要な点:

- `length_mm` は仕上がり線上の長さである。
- 縫い代込みの裁断寸法ではない。
- `variant` は識別記号であり、ソフトウェアの version のような大小関係を持たない。
- `requires` は version 比較ではなく、寸法、許容値、タグ、素材条件などを直接表す。
- `status: deprecated` は手動マークであり、新しい variant が出たことによる自動判定ではない。

### Prototype Notes

`prototype-notes.yml` は、試作で得た教訓を表す。

```yaml
schema: loomit.prototype_notes.v0
notes:
  - id: note-2026-06-28-armhole
    date: 2026-06-28
    result: failed
    issue: armhole tight when raising arms
    observation:
      - bodice lifts when arms are raised
      - sleeve cap feels restrictive
    suggested_change:
      - lower sleeve cap
      - increase armhole ease
    creates_test_case: arm-raise
    applies_to:
      - fitted-armhole
      - non-stretch-fabric
    leftover_fabric:
      reusable_for:
        - collar
        - cuff
      remaining_size: 30cm x 40cm
```

`prototype_notes` は服の実体ではなく、作る人の経験データである。そのため project fork で完全に縁を切る対象にはしない。

v0 では、fork 時に prototype notes をコピーする。将来的に、ユーザー全体の知識ベースへ昇格する余地を残す。

### Body Profile

body profile は個人情報として扱う。

body profile は、性質の違う情報を混ぜない。混ぜると「体に合っていない」のか「好みと違う」のかを後から分離できなくなる。これは `check` / `fit` / `test` を層として分ける方針と同じ考え方である。

v0 では次のバケツに分ける。

- `measurements`: 体の事実。測れば決まる値だけを置く。
- `preferences`: 好み。着用感の指定を置く。体の事実とは別バケツにする。

```yaml
schema: loomit.profile.v0
name: my-size
base_size: 9A

# 体の事実。測れば決まる値だけ。
measurements:
  height_cm: 160
  bust_cm: 84
  waist_cm: 66
  hip_cm: 92
  shoulder_width_cm: 38
  arm_length_cm: 54
  neck_to_wrist_length_cm: 76
  upper_arm_cm: 27

# 好み。体の事実ではなく、着たい感じ。
preferences:
  sleeve:
    length: long
```

`preferences` は、着る位置の好み(ハイウエストで一番細いところに乗せたい、など)も v0 では当面ここに置く。独立した `wearing_positions` バケツに切り出すかは、実際に消費する fit ルールが決まってから判断する。

#### 寸法名の規約

寸法名には始点と終点を含める。「どこからどこまで測るか」が名前から消えないようにする。

- `neck_to_wrist_length_cm`: 体側。首の後ろ(背中心)→ 肩 → 手首。いわゆる裄丈。
- `neck_to_cuff_length_cm`: 服側の仕上がり寸法。首の後ろ → 肩 → 袖口。
- `arm_length_cm`: 肩先 → 手首。裄丈とは別物なので混同しない。

`yuki` のようなローマ字略称は schema 名に使わない。

肩幅が広い人は、`arm_length_cm` が普通でも肩線が内側に来て袖が短く感じることがある。この切り分けには `arm_length_cm` 単独より `neck_to_wrist_length_cm` が効く。

#### 測り方の定義(measurement definition)

「ユーザーが測る値」と「Loomit が想定する定義」がズレると診断が無意味になる。これを防ぐため、測り方の定義は寸法**名に紐づく共有リファレンス**として Loomit 側が一意に持つ。profile ごとの自由記述にはしない(それでは曖昧さが場所を変えるだけになる)。

各寸法名について、始点・経由点・終点・姿勢・締め具合を Loomit がドキュメントで定義し、ユーザーはそれに従って測る。この定義レジストリは docs / reference 側に置き、profile スキーマには持ち込まない。

#### 推定値の扱い

`neck_to_wrist_length_cm` が未入力なら、`shoulder_width_cm / 2 + arm_length_cm` で推定してよい。ただし実測値があれば実測を優先する。

推定を使った場合は、その旨を必ず診断の `source` に明示する。実測由来か推定由来かがユーザーに分からないまま fit 警告を出さない(explainable 原則)。

#### v0 スコープ

- 今ロックするのは上記の「形」だけ: measurements / preferences のバケツ分離、寸法名規約、measurement definition をレジストリとして持つ方針、推定値の source 明示。
- 後回し: 肩幅・袖丈・裄丈を比較する fit ルール本体、`part.loom` 側 finished 寸法の拡張、`elbow` / `thigh` / `rise` などの寸法追加、`preferences` の内部スキーマ確定。これらは最初に消費する fit ルールと同時に入れる(core の check ループが安定してから)。

body profile は共有・公開の対象にしない。外部へ渡す場合は明示的な確認を必要にする。

## 主要フロー

### `loom init`

一着プロジェクトをカレントディレクトリに作る(git init 風)。

```text
mkdir my-blouse-001
cd my-blouse-001
loom init
```

処理:

```text
cli.init
  -> core.createProject()   # targetPath = cwd
  -> project scaffold を作成
  -> loomit.yml を生成
```

生成するもの:

```text
my-blouse-001/
  loomit.yml
  parts/
  notes/
  profiles/
  output/
```

### `loom fork`

既存プロジェクト全体を複製し、新しい一着の出発点にする。

```text
loom fork ../my-blouse-001 my-blouse-002
```

処理:

```text
cli.fork
  -> core.loadProject(source)
  -> core.forkProject(source, target)
  -> target project を作成
  -> source との自動連動は設定しない
```

方針:

- fork 後の新プロジェクトは元プロジェクトから独立する。
- 後から元プロジェクトを変更しても、fork 先には反映しない。
- rebase / merge 的な連動は v0 では実装しない。
- prototype notes は経験データとしてコピーする。

CLI 名は `loom fork` を採用する。`new --from` 形式の別名は作らない(作成コマンドは `loom init` で、`new` は廃止)。

### `loom check`

現在の一着プロジェクトが、仕上がり寸法ベースで縫い合わせ可能かを検証する。

```text
loom check
```

処理:

```text
cli.check
  -> core.loadProject(cwd)
  -> core.resolveParts(project)
  -> core.runChecks(resolvedProject)
  -> cli.formatCheckReport(report)
```

v0 のチェック対象:

- `loomit.yml` の構文
- 参照パーツの存在
- part type と role の整合性
- connector の存在
- connector length の差が tolerance 内か
- `requires` の寸法条件を満たすか
- required file が存在するか
- deprecated part を使っているか

`check` が保証するもの:

- 明示された connector 同士が、仕上がり線の長さとして縫い合わせ可能か。

`check` が保証しないもの:

- 縫い代込みの裁断寸法
- 裁断配置
- カーブ形状の美しさ
- シルエットの好み
- 着用感
- 動作時の快適さ

### `loom diff`

`loom diff` is a core command for using Loomit not only as a sewing validator, but as a sewing-oriented git for trying design branches.

Expected workflow:

- Start from `main`, cut a branch, and try design changes such as darts, tucks, gathers, or ease changes.
- Use `loom diff` to read what changed as domain-level design differences, not just coordinate or blob differences.
- If the toile/prototype is bad, discard the branch. If it is good, merge it back to `main`.
- Around that merge, future Seamlint checks connector / requirement / geometry consistency in a focused, read-only way.
- Final millimeter-level correction and CAD writes belong to future Truer.

So `loom diff` is not just a comparison view. It is the design review surface for deciding whether a branch should be kept or discarded, and the handoff point to prototype notes and later validation tools.

Responsibility split:

- Loomit: owns source-of-truth files and meaningful design diffs.
- Seamlint: checks seam/consistency/geometry around a proposed merge.
- Truer: applies final corrections and CAD-side writes.

### `loom fit`

体型プロファイルと服の出来上がり寸法を比較する。

```text
loom fit --profile my-size
```

処理:

```text
cli.fit
  -> core.loadProject(cwd)
  -> core.loadProfile(profile)
  -> core.runFit(project, profile)
  -> cli.formatFitReport(report)
```

`fit` は断定ではなく、リスクを返す。

### `loom suggest-tests`

現在の一着に必要そうな movement test を提案する。

```text
loom suggest-tests --profile my-size
```

入力:

- garment type
- parts
- tags
- fabric properties
- fit preference
- body profile
- prototype notes

出力:

```yaml
recommended:
  - scenario: arm-raise
    reason: fitted armhole + non-stretch fabric
    source: prototype-note
optional:
  - scenario: sit
    reason: blouse length does not strongly require sit test
    source: built-in-rule
skipped:
  - scenario: squat
    reason: not pants/skirt-related
    source: built-in-rule
```

### `loom test`

採用済み test suite、または指定された scenario を診断する。

```text
loom test --suite daily-blouse
loom test arm-raise --profile my-size
```

`test` は物理シミュレーションではなく、v0 ではルールベース診断でよい。

### `loom build`

現在の一着から出力物を集約する。

```text
loom build
```

v0 では本格 CAD 生成をしない。外部 CAD の SVG/PDF などを集約し、manifest を作るところから始める。

```text
output/
  pattern.svg
  print.pdf
  manifest.json
```

build 前には `check` を実行する。

## Diagnostics

すべての診断結果は、CLI 表示ではなく構造化データを正とする。

```ts
interface Diagnostic {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  target?: string;
  suggestion?: string[];
}

interface CheckReport {
  status: "ok" | "warning" | "error" | "unknown";
  diagnostics: Diagnostic[];
  compatibility: CompatibilityResult[];
}

interface CompatibilityResult {
  status: "ok" | "warning" | "error" | "unknown";
  from: string;
  to: string;
  rule: string;
  actual?: unknown;
  expected?: unknown;
  diagnostics: Diagnostic[];
}
```

CLI はこれをテキストに整形する。Studio はこれを図上のハイライトや問題一覧に変換する。CI は JSON と exit code を使う。

## Rule Architecture

互換チェックは、小さな rule を順番に実行する。

```ts
interface CompatibilityRule {
  id: string;
  description: string;
  appliesTo(context: RuleContext): boolean;
  check(context: RuleContext): Diagnostic[];
}
```

v0 の rule:

- connector exists
- connector type matches
- connector length is within tolerance
- requirement range is satisfied
- required files exist
- deprecated status is reported

将来の rule:

- gather allowance
- stretch fabric allowance
- notch alignment
- intentionally unsewn edge
- mirrored part consistency
- size grading compatibility

外部 plugin runtime は v0 では作らない。まずは core 内の rule registry として始める。

## Reuse Model

Loomit の再利用は project fork による。

```text
Project fork
  - 似た服を作るときに、一着全体を複製する。
  - シルエットの土台ごと持っていく。
  - fork 後は完全に独立する。
```

当初はこれに加えて「気に入ったパーツだけを library へ publish して別プロジェクトで流用する」経路も想定していたが、`.val` は共有作図ネットで detail が独立オブジェクトでなく view であるため、パーツ単体をコピーする単位が Valentina のデータモデルに存在しないと分かり撤去した(経緯は [`design-history.md`](design-history.md))。

## Build Order

v0 実装の推奨順:

1. `core/project`
2. `core/parts`
3. `cli new`
4. `cli fork`
5. `core/compatibility`
6. `cli check`
7. `cli doctor`
8. `core/prototype-notes`
9. `core/fit`
10. `core/movement-tests`
11. `cli suggest-tests`
12. `cli test`
13. `core/build`
14. `cli build`

Studio は、CLI と core の境界が安定してから着手する。

## Open Questions

### コマンド名(決定) / 旧 Open Question: fork 系コマンドと new --from の表記

決定:

- CLI バイナリ名は `loomit` を `loom` に短縮する。プロダクト名は "Loomit" のまま(コマンドだけ短縮、`kubectl` 的な扱い)。
- プロジェクト作成は `loom init`。git init 風に、パス引数なしで**カレントディレクトリ**に scaffold を展開する。project name は cwd のディレクトリ名を既定にする。旧 `new`(名前付きで新ディレクトリを作る)は廃止する。
- 既存プロジェクトの複製は `loom fork` を維持する。`new --from` は作らない(`new` 自体が無くなるため、この Open Question は解消)。

`loom init` の "すでに存在" ガードは、「対象ディレクトリの存在」ではなく「カレントに `loomit.yml` が既にあるか」で判定する(カレントは必ず存在するため)。

反映済み: docs・CLI・テストを `loom` / `loom init` へ一括置換し、`pnpm typecheck` と `pnpm test` が green であることを Node 24 上で確認した。なお `technical-plan.md` は旧設計の legacy ドキュメントのため、意図的に `loomit` 表記のまま残している。

### Prototype Notes の置き場所

v0 では project 内の `notes/prototype-notes.yml` を想定する。

将来検討:

- ユーザー全体の知識ベースを持つか
- project notes と global notes を分けるか
- fork 時にどこまでコピーするか

### Schema Versioning

`schema: loomit.part.v0` のような schema marker を置く想定にしている。

決めること:

- schema marker を必須にするか
- migration command をいつ用意するか
- `variant` と schema version を混同しない説明をどう書くか

### Old Technical Plan の更新

既存の `technical-plan.md` には、`version: 3` や `requires: ">=4"` など、旧前提の例が残っている。アーキテクチャ v0 では、`variant` と寸法条件ベースの新方針を採用する。

次に資料を整理するときは、`technical-plan.md` のデータ形式例とチェック項目をこの文書に合わせて更新する。

## v0 の結論

Loomit は、服作りのための大きな GUI アプリではなく、まず信頼できる core と CLI を持つローカルファーストの検証ツールとして作る。

最初に実装すべき価値は、`loom check` によって「この一着のパーツは仕上がり寸法として縫い合わせ可能か」を説明可能に判断できることである。

その上で、`fit`、`suggest-tests`、`test`、`prototype_notes` によって、着用感や動作リスクを少しずつ扱えるようにする。
