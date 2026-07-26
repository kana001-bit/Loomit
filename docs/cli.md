# Loomit CLI Dictionary

この文書は、`loom` コマンドが何をするか・いつ使うかをまとめたコマンド辞書である。

## Overview

Loomit の CLI は、大きく次のワークフローに分かれる。

- project を作る・複製する: `init`, `fork`
- part を追加する: `add`
- project の整合性を確認する: `check`, `doctor`, `fit`, `suggest-tests`, `test`
- project から成果物を build する: `build`
- 設計変更を比較する: `diff`

## `loom init`

現在のディレクトリに新しい Loomit project を作成する。

```text
loom init [--name name] [--garment garment]
```

補足:

- `git init` のように、**現在のディレクトリ**に project の scaffold を作る。
- `--name` を省略した場合はディレクトリ名が project 名になる。

## `loom fork`

既存 project を複製して、新しい target ディレクトリに複製する。

```text
loom fork <source> <target> [--name name]
```

補足:

- 元 project の構造をそのまま複製する（fork 後は元と自動連動しない）。
- `--name` を省略した場合は target ディレクトリ名が project 名になる。

## `loom add`

Valentina の `.val` を project に取り込む。1着 = 1 `.val` = 複数ピースという実データに合わせ、`.val` の `<detail>`（裁断ピース）ごとに part を1つずつ用意する。

```text
loom add [file.val] [--yes]
```

挙動:

- `.val` から `<detail>` ピースを検出したら、**ピースごとに part を1つ** scaffold する。
- 生成した part は `parts/<role>/` に書き出す。
- 生成した各 `part.loom` は `files.source`（共有 `.val`）と `files.piece`（担当する detail 名）を記録する。
- `<draw>` はあるが `<detail>` が1つも無い `.val`（construction のみ）は、案内を表示して何も追加せずに終了する。
- draw も detail も検出できない `.val` は、従来どおり単一 part の対話に倒す。

`file.val` を省略した場合（自動発見）:

- 「まだ取り込まれていない `.val`」を project root 直下と `parts/` 配下（再帰）から探す。判定は `loom check` の `UNREGISTERED_VAL_SOURCE` と同じ実装を共有する: どの part の `files.source` でもなく、登録済み `.val` と同一内容の残骸コピーでもないものが候補になる（残骸は理由つきで候補から除外される）。
- 候補が **1つ** — それを取り込む。どのファイルを選んだかを表示する。
- 候補が **0** — part が1つも無ければ、`.val` の置き場所（root 直下か `parts/` 配下）を案内して失敗する（exit 1）。part があれば「取り込むものは無い」と表示して正常終了する（exit 0。取り込み済み project で再実行しても安全）。
- 候補が **複数** — どれを取り込むか対話で選ぶ。`--yes` のときは対話端末に限って選択だけを訊き、非対話（CI・パイプ）では候補一覧と明示パスの案内を出して、何も書かずに失敗する（exit 1）。
- 走査自体が失敗した場合（権限エラー等。`parts/` が無いだけなら正常な不在として扱う）— 候補ゼロに見せかけず、原因つきの診断を出して失敗する（exit 1）。

オプション:

- `--yes`, `-y` — 対話をせず、検出した全ピースをデフォルト（role=ピース名、type `body`、variant `v1`、connector なし）で一括 scaffold する。多ピースの `.val` を最短で `loom check` が通る骨組みにする用途。role が既存 part と衝突するときだけ、対話端末に限って distinct な role を訊く（非対話では何も書かずに失敗する）。

対話で尋ねる項目:

- detail 単位の add: `role`, `name`, `type`, `variant`, seam connector
- 従来の単一 part の add: `name`, `type`, `variant`, seam connector

補足:

- `role` は project 側の part identity（例: `front`, `back`, `upper_sleeve`）で、`loomit.yml` の parts key かつ `parts/<role>/` のディレクトリになる。パス segment 制約がある。
- `type` は粗分類（例: `body`, `sleeve`）で、role とは別軸。同じ type のピースが複数あってよい。
- `name` は part.loom のラベルで、パスにもキーにも使わない。安全 segment 制約は課さないので、空白や日本語も使える。
- 質問はパイプでも与えられる（例: `loom add body.val < answers.txt`）。
- 取り込み後は `loom check` を実行する。

## `loom connect`

既に add 済みの part を「縫い合う」と宣言する。参加する各 `part.loom` に**同じ id の connector を書き込む**ので、`loom check` がその id でペアにし、`loom slnt check` が共有 seam を測れるようになる。`loom add --yes` で骨組みだけ作った後の配線工程。

2つの形がある:

```text
loom connect <roleA> <roleB> --as <id> [options]          # 素の seam（2枚が端どうし）
loom connect <band> --to <n1> <n2>... --as <id> [options]  # band seam（1枚 対 複数枚）
```

- **素の seam** — front↔back の脇線のように、2枚が端どうしで縫い合う。`side` は書かない。
- **band seam** — 腰帯が前+後に、袖ぐりが前身頃+後身頃に縫い付くように、1枚の band が「長さの和がそれに等しい複数枚」に縫い合う。`--to` で複数枚を並べると、band 側/neighbour 側の `side` は**コマンドが裏で書く**（作者は `side` を触らない）。

オプション:

- `--as <id>`（必須）— 縫い目の一意 id。参加 part 全部に同じ id が書かれ、それがペアの成立条件になる。
- `--to <roles...>` — band モードに切り替える。band が縫い付く neighbour ピース群（1枚以上）。
- `--type <type>` — 縫い目の種類ラベル（例: `side`, `armhole`）。ペアリングには使われない。未指定なら id にフォールバック。
- `--notches <n>` — この seam の合印（notch）数（非負整数）。**その辺に落ちる全 passmark 種別（V・T・castle…）の合計を数える**（V だけ数えない。Seamlint が全レイヤの notch を読んで数を厳密一致で照合するため）。band モードでは neighbours 側に書く。同じピースを共有する複数 seam を Seamlint が辺ごとに区別するための識別子。
- `--band-side <s>` / `--neighbour-side <s>` — band モードの side ラベル。既定は `band` / `neighbour`。値は2側が別なら任意（`classifyJoinSides` が2側の contiguous と見なせればよい）。
- `--path-ref-a <block>` / `--path-ref-b <block>` — 各 part の測定用 DXF BLOCK 名（**素の seam 専用**）。未指定なら各 part の `files.piece` を既定にする（BLOCK 照合は大文字小文字を無視するので `front` が `FRONT` に当たる）。

補足:

- **「縫い合う」を表すのは side ではなく共有 id。** `side` は band のときだけ要る「この N枚は同じ側＝長さが足し算で1本の band に合う」の判別ラベルで、素の seam には付かない（重ね＝coincident と区別するため）。
- **辺（座標）は入力しない。** 人が渡すのはトークン（id / path_ref / notch_count）だけで、どの辺が共有縫い線かは Seamlint が幾何から発見する（`seam-edge` / `band-seam`）。
- connector は複数 part を組む cross-part join 専用なので、同じ role 同士は接続できない（自己シームは Seamlint が測る）。
- 実測まで行くには各 part に `files.geometry`（DXF）か `files.preview`（SVG）が要る。無い側は成功時に案内する。**band seam は band 接辺の和を測るため全側 DXF が要る**（SVG は辺分割できない）。
- 例（素）: `loom connect front back --as outseam --notches 2`
- 例（band）: `loom connect waistband --to front back --as waist --notches 2` → 3枚の part.loom に `connectors.waist` を書き（band=waistband、neighbours=front/back）、次に `loom slnt check` が `band-seam` を1本出す。

## `loom check`

project と part の整合性を検証する。

```text
loom check [path] [--format text|json]
```

補足:

- `loomit.yml` と参照している part を検証する。
- connector や `requires` の互換を確認する。
- `parts/` 配下に、どの part も参照していない `.val` があれば warning で知らせる。

## `loom doctor`

`check` より詳しい説明つきの診断を出す。

```text
loom doctor [path] [--format text|json]
```

補足:

- `check` と同じ検証を土台にする。
- 「通るか」より「どこが怪しいか」を読みやすく示すためのコマンド。

## `loom build`

参照 part を集めて、設定された output ディレクトリに build 結果を書き出す。

```text
loom build [path] [--format text|json]
```

補足:

- part を解決し、`check` 相当の互換検証を走らせてから build 出力を書く。
- 致命的でない問題は、逐一失敗させず可能なら warning で伝える。

## `loom slnt request`

project から Seamlint へ渡す geometry request（handoff）を組み立てる。`slnt` は Seamlint 連携の名前空間で、`request` はその動詞。

```text
loom slnt request [path] [--format text|json]
```

補足:

- `loomit.yml` と part を読み、check と同じ readiness 判定をしたうえで `parts` / `checks` からなる request を出力する。
- part の geometry source は `files.geometry` を優先し、無ければ `files.preview` を使う。
- `path_ref` や geometry source が欠けている seam は diagnostic を出して skip する。
- warning のみであれば、exit code 0 のまま report status `warning` を返す。

## `loom slnt check`

`loom slnt request` で組み立てた geometry request を、実際に Seamlint に渡して seam を測定する end-to-end。

```text
loom slnt check [path] [--slnt <path>] [--format text|json]
```

補足:

- request を組み立て、各 part の geometry source（`files.geometry` 優先、無ければ `files.preview`）を読んで request に inline し、self-contained な JSON を作る。
- その JSON を `slnt check-request --json` に stdin で渡し、返ってきた `GeometryRequestReport`（seam ごとの pass/fail・長さ）を Loomit 側の診断と合わせて表示する。
- Seamlint 実行ファイルは `--slnt <path>`、環境変数 `LOOMIT_SLNT`、PATH 上の `slnt` の順で解決する。見つからなければ error（`SEAMLINT_NOT_FOUND`）にして、インストールか `--slnt` 指定を促す。
- 測る seam が1つも無ければ Seamlint は呼ばず、`seamlint: skipped` を返す。
- responsibility 分担は不変（Loomit=構造とグラフ＋request 発行、Seamlint=幾何測定）。Loomit は幾何を計算しない。

### band seam を Truer に渡して直し方を提案させる

band seam（1枚 対 複数枚）の不一致 `geometry.band_seam_sum_mismatch` は **project 全体を測る `loom slnt check` からしか出ない**（N-ary なので2パーツ指定の `loom match` は通らない）。pairwise の [`loom match --reference`](#--reference-part-truer-に直し方を提案させる) に相当する band 専用の `loom` 動詞は今のところ無い ── band は稀にしか鳴らず、Truer は report に混ざって届いた band 診断をそのまま消費できる（入口に依存しない）設計なので、薄い動詞を1本足すより**手動導線**に倒している（設計判断。将来 `loom` に passthrough を足す余地は残す）。

手順（`slnt` / `tru` は用意済みの前提）:

1. **project 全体を測って band-seam を含む report を JSON で出す。**

   ```text
   loom slnt check --format json --slnt <slnt> > check.json
   ```

   - `--slnt` は**単一の実行ファイル**を指す（PATH 上の `slnt`、または `slnt.cmd` / `.exe` のラッパー）。`loom slnt check` の `--slnt` は `"node path/to/slnt.js"` のような**空白区切りの multi-token を受け付けない**（Truer の `--slnt` は受け付ける ── 下記 3 の注記）。`slnt` を PATH に通せない環境ではラッパーを1枚用意する。

2. **raw Seamlint report を取り出す。** `loom slnt check --format json` は Loomit のラッパー（`{ status, diagnostics, seamlint: { report } }`）で出力し、seam の測定はネストの `.seamlint.report` にある。`tru propose --diagnostic` が読むのは**トップレベルに平坦な `diagnostics` 配列を持つ raw Seamlint report** なので、`.seamlint.report` を抜き出す（ラッパー直渡しだと Truer はトップレベルの Loomit 診断を読み、band を1件も拾わず 0 提案になる）。

   ```text
   node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync('check.json','utf8'));fs.writeFileSync('report.json',JSON.stringify(r.seamlint.report))"
   ```

3. **Truer に advisory を作らせる。** band の BLOCK を含む DXF（＝band パーツの `files.geometry`）を pattern に渡す。

   ```text
   tru propose <band.dxf> --diagnostic report.json --reference <block...> --out output/match/band.proposal.json --slnt "node path/to/slnt.js"
   ```

   - `--reference` は**固定側の BLOCK 名**で、診断の blockName の**大小文字にそのまま合わせる**（band connector の `path_ref` が `files.piece` 由来なら小文字）。
     - neighbour 群を渡す → **band を conform**（band 長を Σ隣接に合わせる目標 `targetBandLengthMm` が出る）。
     - band を渡す → **band 固定**（neighbours を直す向きだけ示す。N-ary なので per-neighbour の配分は推測しない）。
     - 両方 / どちらも渡さない → 両方向 preview-only。
   - Truer の `--slnt` は preview の辺解決で内部から Seamlint を呼ぶために要る。**こちらは空白区切りで `"node <slnt.js>"` を受ける**（`loom` の `--slnt` と扱いが違う）。git-bash では Windows 形式（`C:/...`）で渡す（`/c/...` は `C:\c\...` に化ける）。
   - proposal は **preview-only（advisory）**。`changes: []` で source DXF は書き換えない ── 人が Valentina で当てるための指示ログ。

Truer 側の CLI 仕様（`tru propose` のオプション・proposal の読み方）は [Truer](https://github.com/kana001-bit/Truer) の `docs/cli.md` にある。

## `loom match`

名指しした2パーツの縫い目**だけ**を測り、長さが合っているかを pair 単位で報告する。project 全体を測る `loom slnt check` に対し、`loom match` は「front と back は合っているか」を局所的に問う導線。`front` を `back` に「合わせる」＝ `match`。

```text
loom match <partA> <partB> [--reference <part>] [--slnt <path>] [--tru <path>] [--format text|json]
```

補足:

- **pair-local**。2パーツが互いに縫い合う縫い目だけを対象に request を組み、**その縫い目についての診断だけ**を返す。project 全体の readiness や無関係パーツの connector 問題は結果にも exit code にも混ざらない（project 全体の健全性は `loom check` の役割）。
- 縫い目の絞り込みは side を見て行う（band-seam では band と neighbour は反対側なので拾うが、neighbour どうしは同じ側＝互いには縫わないので拾わない）。どの辺が共有 seam かは Seamlint が幾何から発見する（`loom slnt check` と同じ seam-edge / band-seam の測定）。辺の座標は渡さない。
- Seamlint 実行ファイルの解決は `loom slnt check` と同じ（`--slnt` > `LOOMIT_SLNT` > PATH 上の `slnt`）。
- 早期に弾くケース（Seamlint を呼ばない）:
  - `MATCH_ROLE_NOT_FOUND`（登録されていない role）／`MATCH_SAME_ROLE`（同じ role 同士）は error（exit 1）。
  - `MATCH_NO_SEAM` は**縫い合うと宣言されていない**（共有 connector が1つも無い）2パーツにだけ出し、`loom connect` を促す（exit 1）。
  - 接続はあるが check を組めない（`path_ref` 欠落・多パーツで defer・側の宣言不完全など）ときは `MATCH_NO_SEAM` にはせず、その**理由の診断**を出して測定を skip する（既に接続済みの pair に `loom connect` を勧めない）。

### `--reference <part>`（Truer に直し方を提案させる）

`--reference` に2パーツのどちらか一方を渡すと、その辺を**固定側**とみなし、測定済み report を Truer に渡して**もう片方をその長さに合わせる**直し方（proposal）を提案させる。

- `--reference` は名指しした2パーツのどちらかでなければ usage エラー（exit 2）。固定でない側（follower）が Truer の補正対象。
- follower は DXF が要る（Truer は `files.geometry` の DXF の辺を書き換える）。follower に `files.geometry` が無ければ `MATCH_REFERENCE_NEEDS_DXF` を出し、測定結果は返しつつ Truer は呼ばない。
- loom は follower の DXF・reference の BLOCK 名・出力先を組み立てて `tru propose <dxf> --diagnostic <report> --reference <BLOCK> --out <path> --slnt <slnt>` を spawn する。report は一時ファイルで渡す。Truer も preview の edge 解決で内部から Seamlint を呼ぶため、loom が測定に使ったのと**同じ slnt を `--slnt` で転送**する（渡さないと Truer が PATH 上の `slnt` を探して失敗する）。
- proposal の出力先は **`output/match/<partA>-<partB>.proposal.json`**（`outputs.dir` 配下・無ければ `./output`）。**advisory（preview-only）**で、人が Valentina で当てるための指示ログ。loom は幾何を書き換えない。
- Truer 実行ファイルの解決は `--tru` > `LOOMIT_TRU` > PATH 上の `tru`。見つからなければ error。
- `--reference` を付けなければ、従来どおり測定のみ（Truer は呼ばない）。
- `loom match` は pairwise 専用。band seam（1枚 対 複数枚）の不一致 `geometry.band_seam_sum_mismatch` は N-ary でここを通らない ── band を Truer に渡す手順は [`loom slnt check` の band 節](#band-seam-を-truer-に渡して直し方を提案させる)を参照。
- **`tru propose` の2系統を取り違えない。** ここ（`loom match --reference`）は **DXF を直す**系統（`tru propose <dxf> --diagnostic <report> --reference <BLOCK>`）で、入力は測定済み Seamlint report、対象は follower の DXF。これとは**別系統**として、`.val` ソースのどのパラメータを動かせば直るかを示す **provenance payload**（拘束グラフ・schema `loomit.constraint-payload.v0`）を出すのが [`loom truer request`](#loom-truer-request)。入力（report ↔ payload）も目的（DXF パッチ ↔ ソース provenance）も別物。

## `loom truer request`

project から Truer へ渡す**拘束 payload**（provenance）を組み立てる。`truer` は Truer 連携の名前空間で、`request` はその動詞（`slnt request` の対＝**測定は走らせない**純粋な payload ビルダ）。

```text
loom truer request [path] [--format text|json]
```

補足:

- `loomit.yml` と part を読み、`slnt request` と同じ readiness 判定をしたうえで、封筒 `{ status, diagnostics, payload }` を出力する。
- payload は**版付き**（`schema: "loomit.constraint-payload.v0"`）。各 part の `files.source`（`.val`）を読み、`files.piece` の合印が載るカーブ経由で「その seam の長さに効く `.val` パラメータ」を集める。契約正本は `packages/core/src/schema/constraint-payload.schema.ts`、共有 JSON Schema は `packages/core/schema/constraint-payload.v0.json`。
- **依存は part 単位**（`parts[].dependsOn`）。`connectors[]` は `(partId, connectorId)` の **join 鍵のみ**で `dependsOn` を持たない ── connector 単位では辺を絞れず（どの合印がどの seam かは `.val` に無く、測定辺の特定は Seamlint の責務）、1 piece の全 seam の occurrence が混ざる。
- **`parts[].notches[]`** は同じ occurrence を **notch 単位に束ね直した additive な view**（`dependsOn` はフラットのまま残す）。各 notch は `order`（piece 輪郭順・位置でなく順序でマッチ）・`rawPassmarkLine`（`.val` の生値）・`notchType`（`v`/`t`/`castle`/`check`/`u` に正規化・写像できたときだけ）・`anchorPointId`・`splineId`・`lengthCandidates`（その spline の端点/ハンドル occurrence）を持つ。Truer が測定辺の合印と順序＋種別で突き合わせ、`linearity:linear` かつ候補 1 項のとき具体数値を提案する（applicable）用。spline に載らない合印は `splineId` を持たず `lengthCandidates` は空。
- 増分は `declared` union（`declared:true`＝`<increments>` に宣言あり・`value` 持ち／`declared:false`＝式で参照されたが宣言なし）。`usedBy` は **part 単位 membership**（その増分をその part のいずれかの追跡 seam 辺に持つ role 集合。per-seam の両辺判定は与えない）。
- `files.source` / `files.piece` の無い part は payload に載らない。piece が `.val` に無い（`PART_SOURCE_VAL_PIECE_NOT_FOUND`）等は診断で surface する。warning のみなら exit code 0 のまま status `warning` を返す。
- `diagnostics` は **Loomit 自身の payload 抽出診断**であって Seamlint report ではない（幾何の測定結果は入らない）。Truer は payload を消費し「`.val` のどのパラメータを動かせば seam が直るか」を provenance として提案する（`.val` は書かない）。責務分担は不変（Loomit=構造抽出／Seamlint=幾何測定／Truer=修正提案）。

## `loom diff`

2つの part、2つの project 内の同一 role part、または **Git の revision 間**で同一 role part を比較する。

```text
loom diff <from-part.loom> <to-part.loom> [--format text|json]
loom diff <from-project> <to-project> --part <role> [--format text|json]
loom diff <from-rev>..<to-rev> --part <role> [--format text|json]
loom diff <rev> --part <role> [--format text|json]
```

補足:

- raw file diff ではなく、ドメインを踏まえた変更として読む。
- connector や requirement について recheck のヒントを含める。
- **各 revision は project の snapshot**であり、`loom diff` は2つの snapshot を意味的に比較する。snapshot の保存・履歴・branch は Git に委譲し、Loomit は独自の `snapshot` / `commit` コマンドを持たない（用語は [glossary.md](glossary.md) の Snapshot / Revision 参照）。
- **revision 形式**は現在の一着（cwd の project）を Git 履歴の版と比較する。history は Git に委譲する方針（[design-history.md](design-history.md) 参照）で、Loomit は各 revision を一時 worktree に展開してから既存の意味差分に流す。git shell は CLI 層に閉じ、core の diff は pure なまま。
  - `main..HEAD` は2つの revision を比較。`<rev>` 単体はその版と作業ツリー（未コミット含む）を比較。
  - どちらも project 差分なので `--part <role>` が必須。repo 内で実行する。不正な revision や repo 外実行は usage エラー（exit 2）。

## `loom fit`

project を body profile と照合する。

```text
loom fit [path] --profile <name|path> [--format text|json]
```

補足:

- 利用できる場合は project の finished measurements を使う。
- 断定ではなく fit の診断・リスクを返す。

## `loom suggest-tests`

project で確認すべき movement test を提案する。

```text
loom suggest-tests [path] [--notes path] [--format text|json]
```

補足:

- prototype notes があれば、それを踏まえて提案する。

## `loom test`

1つの movement test scenario を実行する。

```text
loom test <scenario> [path] [--notes path] [--format text|json]
```

補足:

- `v0` では scenario の対応範囲を意図的に小さく保っている。

## Output Formats

次のコマンドは `--format text|json` を持つ。

- `check`
- `doctor`
- `build`
- `diff`
- `fit`
- `suggest-tests`
- `test`
- `slnt request`
- `slnt check`
- `truer request`

## Notes

- コマンドの実装は `packages/cli/src/commands/` にある。
- Loomit は CLI を小さく、project 操作に絞って保つことを意図している。
