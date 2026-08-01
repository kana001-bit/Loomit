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
- **`.val` はコピーされない。** project 内にある `.val` はその場を参照し、`files.source` には project root 相対パス（例: `knickers.val`、`parts/knickers.val`）を書く。1着の `.val` から N 個の part を作っても `.val` は1つのまま。
- project の外にある `.val`（Downloads 等）だけは取り込む。schema が絶対パスと `..` を拒否するため参照できないので、**project root に1つだけ**コピーする（part ごとではない）。取り込み元は削除しない。
- project root に同名ファイルが既にある場合、内容が同じならコピーせずそれを参照し、内容が違えば `PART_ADD_SOURCE_TARGET_CONFLICT` で失敗して何も書き込まない（既存ファイルを黙って差し替えない）。
- 内外の判定は symlink を解決した実体パスで行う。project 内の名前で project 外のファイルに届く場合（外を指す symlink / ディレクトリリンク越し）は `PART_ADD_SOURCE_ESCAPES_PROJECT` で失敗する。実体のパスを渡せば、project 外の `.val` として正しく取り込める。
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
- これら（`UNREGISTERED_VAL_SOURCE` / `PART_FILE_COPY_STALE` / `PART_GEOMETRY_STALE`）は **readiness 判定**として共有され、`loom build` / `loom slnt request` / `loom slnt check` / `loom truer request` でも同じように出る。いずれのコマンドも同じファイルを読むため、`check` だけの警告にはしない。
- part 内の `files.*`（`source` / `preview` / `geometry` / `print`）が、project root の同名ファイルと内容不一致なら warning（`PART_FILE_COPY_STALE`）で知らせる。`files.*` は **project root 相対を優先**して解決し、root に無ければ part ディレクトリ相対に落ちる。つまり両方あるとき読まれるのは root 側で、part 内のコピーは使われない。警告の目的は2つ: コピーを編集しても結果が変わらない空振りに気付けるようにすること、同名の別ファイルを part 側に置いていた場合に root 側が黙って勝つことを知らせること。診断は内容が違うという事実だけを述べ、削除・root 側の更新・リネームの3通りを案内する。
- **`files.geometry`（DXF）が `files.source`（`.val`）より古いとき** warning（`PART_GEOMETRY_STALE`）で知らせる。`.val` から DXF への書き出しは Valentina 側の手作業なので、「製図を直したが書き出し直していない」状態が普通に起きる。そして失敗として表に出ない ── `loom slnt check` は**書き出し済みの幾何**を測るので、古い DXF に対して古い数値を自信満々に返す。
  - **断定はしない**。`.val` の編集が必ず幾何を動かすとは限らない（点の改名やラベル移動なら、書き出し直しても DXF は変わらない）。事実（DXF のほうが N 日古い）だけを述べ、書き出し直す／意図的なら無視してよい、の両方を案内する。
  - 比べているのは更新時刻だけ。Loomit は書き出しに関与しないので「この DXF がどの `.val` から出たか」を知る手立てが無い。**2 秒以内の差は「同じ操作で書かれた」とみなす** ── `git clone` / `checkout` は全ファイルの更新時刻を操作時刻にし書き込み順も保証されない（隣接ファイルはミリ秒オーダー）、FAT / exFAT の更新時刻粒度は 2 秒。猶予はこの「一括書き込みのばらつき」を吸収する幅に留める。人の編集は秒オーダーで起きるので、**書き出した数十秒後に製図を直したケースは警告する**（見逃しはこの検出が潰そうとしている失敗そのもの）。
  - 診断は**ファイルの対ごとに1件**。複数 part が同じ `.val` と同じ DXF を共有していても、同じ事実を part の数だけ並べない。

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

- part を解決し、`check` と同じ readiness 判定と互換検証を走らせてから build 出力を書く。readiness の warning（`UNREGISTERED_VAL_SOURCE` / `PART_FILE_COPY_STALE` / `PART_GEOMETRY_STALE`）は build が成功しても握りつぶさずレポートに載せる。build が output へ配る `files.*` の実体は、`check` と同じ規則（project root 相対を優先）で解決したファイル。
- 致命的でない問題は、逐一失敗させず可能なら warning で伝える。

## `loom slnt request`

project から Seamlint へ渡す geometry request（handoff）を組み立てる。`slnt` は Seamlint 連携の名前空間で、`request` はその動詞。

```text
loom slnt request [path] [--format text|json]
```

補足:

- `loomit.yml` と part を読み、check と同じ readiness 判定をしたうえで `parts` / `checks` からなる request を出力する。readiness の warning（`UNREGISTERED_VAL_SOURCE` / `PART_FILE_COPY_STALE` / `PART_GEOMETRY_STALE`）は結果に載る。
- part の geometry source は `files.geometry` を優先し、無ければ `files.preview` を使う。
- `path_ref` や geometry source が欠けている seam は diagnostic を出して skip する。
- warning のみであれば、exit code 0 のまま report status `warning` を返す。

## `loom slnt check`

`loom slnt request` で組み立てた geometry request を、実際に Seamlint に渡して seam を測定する end-to-end。

```text
loom slnt check [path] [--slnt <path>] [--format text|json]
```

補足:

- `loomit.yml` と part を読み、`slnt request` と同じ readiness 判定をしたうえで request を組み立てる。readiness の warning（`UNREGISTERED_VAL_SOURCE` / `PART_FILE_COPY_STALE` / `PART_GEOMETRY_STALE`）は結果に載る。Seamlint に渡す幾何ファイルの実体は、`check` と同じ規則（project root 相対を優先）で解決したもの。
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

- `loomit.yml` と part を読み、`slnt request` と同じ readiness 判定をしたうえで、封筒 `{ status, diagnostics, payload }` を出力する。readiness の warning（`UNREGISTERED_VAL_SOURCE` / `PART_FILE_COPY_STALE` / `PART_GEOMETRY_STALE`）は結果に載る。payload は各 part の `files.source` から拘束パラメータを抽出する。読む `.val` の実体は、`check` と同じ規則（project root 相対を優先）で解決したもの。
- payload は**版付き**（`schema: "loomit.constraint-payload.v0"`）。各 part の `files.source`（`.val`）を読み、`files.piece` の合印が載るカーブ経由で「その seam の長さに効く `.val` パラメータ」を集める。契約正本は `packages/core/src/schema/constraint-payload.schema.ts`、共有 JSON Schema は `packages/core/schema/constraint-payload.v0.json`。
- **依存は part 単位**（`parts[].dependsOn`）。`connectors[]` は `(partId, connectorId)` の **join 鍵**であって `dependsOn` を持たない ── connector 単位では辺を絞れず（どの合印がどの seam かは `.val` に無く、測定辺の特定は Seamlint の責務）、1 piece の全 seam の occurrence が混ざる。
- **`connectors[].pathRef`** は幾何ソース上の**住所**（`connectors.*.path_ref` を正規化した値。`svg:path#armhole` → `armhole`）。`loom slnt request` が Seamlint に渡す `parts[].paths[connectorId]` と**同じ綴り**で、Seamlint はその綴りを診断の `blockName` にそのまま返すので、消費側は診断 → connector → part を推測なしに辿れる。大小は畳まない（BLOCK 照合を大小無視で行うのは Seamlint 側）。
  - **住所の権威は `pathRef`、provenance の権威は `parts[].piece`。** `piece` は `.val` の detail 名で、`dependsOn` / `notches` がどのピース由来かを示す鍵。DXF の BLOCK 名は Valentina が export 時に大文字化した結果なので、`piece` は BLOCK 名そのものではない。両者は `loom connect` の既定（`path_ref` は `files.piece` から採る）で一致することが多いが、**一致は保証されない**（`--path-ref-a/-b` で上書きでき、SVG 幾何では `svg:path#…` になる）。BLOCK 名として使ってよいのは `pathRef` だけ。
  - `path_ref` を宣言していない connector には `pathRef` を**載せない**（`piece` 等で代用を発明しない）。v0 に additive で足した optional フィールドなので、`pathRef` を持たない payload も契約上 valid。
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
- **`.val` の製図式が動いたら `same` で終わらせない**。`loom diff` が比べるのは宣言（`part.loom`）と射影フィーチャ（darts / notches）で、製図式（`waist_circ + 2` → `+ 5` のような幾何パラメータ）は**幾何なので Loomit は計算しない**。それでも「動いた」ことは `.val` の構造から分かるので、`draftingSource`（`same` / `changed` ＋ 変わったパラメータ数）として report に載せる。
  - `status` は `same` のまま（宣言と射影フィーチャとしては本当に同一）。`status` に混ぜると `changed` の意味が薄まり、それを見ている消費者が壊れるため、**additive な別フィールド**にしてある。
  - **何を見ているか**: `<draw>` の中の**全要素の全属性**（`<calculation>` の `length` / `angle` / `x` / `y` / `type`、`<arc>` の `radius`、`<spline>` のハンドル、`<operation>` の変換、`<modeling>` の参照、`<detail>` の `width`＝縫い代や `<node idObject>`＝型紙輪郭の構成）＋ `<unit>`（cm↔mm）＋ `<increments>` の式。式は評価しない（`a + 2` と `a+2` は別物として数える）。
  - **無視するのは装飾だけ**: `id` / `uuid` / `mx` / `my` / `name` / `showLabel` / `visible` / `enabled` / `inUse` / `color` / `lineColor` / `penStyle` / `typeLine`。拾う属性を列挙する方式にすると `.val` に新しい幾何属性が出たとき黙って取りこぼすので、**除外側を列挙**している。Valentina 側で綴りが直った属性（`firstToCountour`→`firstToContour` など）は新しい綴りへ正規化してから比べる（値は同じなのに「消えて生えた」と数えないため）。
  - `changes` と**重なることがある**。合印を1つ足すと `[added] notch …` と `draftingSource: changed` の両方が動く。二重計上より「どちらかが黙る」ほうが害が大きいという判断（説明文が出るのは `changes` が空のときだけ）。
  - **内訳を持つ**（`draftingSource.changes[]`）。要素ごとに `kind`（added / removed / modified）、`tag`（point / spline / detail / increment …）、`id`、`name`、そして modified なら変わった属性の `before` / `after`。text 出力では `wb1 (point 119)  length: waist_circ + 2 -> waist_circ + 5` のように出す。
    - **見出しには表示名（`name`）を使う**。`point 119` だけでは作者に伝わらないため。`name` は**比較には使わない**（改名は幾何を動かさないので無視属性）が、説明には使う ── 同一性の判定と人への説明は別の仕事。
    - added / removed は `fields` を空にする。追加された点の全属性を並べても読めないので、増えた／消えたの事実だけを渡す。
    - text 出力は先頭 10 件まで（超えたら `… and N more`）。製図を作り直すような編集では数百件になり、その規模では件数のほうが判断材料になるため。**JSON には全件入る**ので、ツール側は制限を受けない。
    - 内訳は**構造の差分があっても出す**。connector を直しつつ `.val` の式も直すのは普通の作業なので、そこで内訳が消えると件数だけが残る。
    - **`id` を持たない要素（detail の `<node>` など）は個別に報告しない**。それ単体では指せない構成要素で、位置（何番目か）を identity にすると先頭に1件挿入しただけで後続が全部ずれ、**動いていない要素まで changed と名指しする**。報告できる単位は **XML 上の最も近い `id` 持ち祖先**（`<detail id>` / `<path id>` / `<operation id>`）なので、順序込みで畳んだ擬似属性 `#contents` の変更として1件で出す（text は `front (detail 106)  contents changed`）。値は比較用のダイジェストで、人に見せる意味は無い。
  - **どの part の製図が動いたかは言わない**。1つの `.val` を複数 part が共有し、calculation の点を piece に帰属させられない（[C6]）ため、`.val` を共有する全 part に同じ信号が出る。幾何の影響量は `loom slnt check`（Seamlint）で測る。
  - `status` は `same` / `changed`（＋変わった件数）のほか、**片側にしか `.val` が無いときは `added` / `removed`**（比較そのものが成立しないので件数は持たない）。`.val` がその版に未コミット、というだけの状況を「製図が動いた」と混同しないため。
  - **片側でも `.val` が読めなかったとき（権限エラー等）は `draftingSource` を出さない**。読めなかった事実は `PART_SOURCE_VAL_READ_FAILED`（warning）が伝えるので、diff は推測しない。両側とも `.val` が無いときも**フィールドごと省略**する（JSON の消費側は不在を扱うこと）。
- **`part.loom` が書いていない darts / notches は `files.source`（`.val`）から read-only に射影して比べる**。1つの `.val` は1着ぶん（1 draw ＋ N detail）なので、射影は **`files.piece` の detail に属するものだけ**に絞る（合印は detail 直下の node、ダーツは detail の `<iPaths>` が id で名指しする内部パス）。`files.piece` が無く detail が2枚以上ある `.val` では絞れないため、全ピース分を射影したうえで `PART_SOURCE_VAL_PIECE_UNDECLARED`（warning）を出す ── 他ピースのフィーチャが混ざった差分になりうる、という意味。逆に**宣言した `files.piece` が `.val` に無い**ときは `PART_SOURCE_VAL_PIECE_NOT_FOUND`（warning）を出して射影は空のままにする（全ピースへは広げない）── 綴り違いや Valentina 側の detail リネームで、差分からダーツ・合印が丸ごと消えたまま正常に見えるのを防ぐ。`part.loom` に inline で書いてあるフィーチャは射影せずそのまま使う。
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
