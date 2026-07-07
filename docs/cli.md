# Loomit CLI Dictionary

この文書は、`loom` CLI のコマンド辞書である。

実装済みコマンドを中心に、

- 何をするコマンドか
- どういうときに使うか
- 最低限の使い方は何か

をすぐ確認できるようにまとめる。

## Overview

Loomit の CLI は、大きく次の役割に分かれる。

- project を作る: `init`, `fork`
- part を用意する: `add`
- project を検証する: `check`, `doctor`, `fit`, `suggest-tests`, `test`
- project から成果物を作る: `build`
- 変更を読む: `diff`
- part を資産化して再利用する: `publish`, `library`

## `loom init`

現在のディレクトリに Loomit project を初期化する。

```text
loom init [--name name] [--garment garment]
```

主な用途:

- 新しい一着 project の作成
- 空の scaffold の作成

補足:

- `git init` のように、**現在のディレクトリ**を初期化する
- パス引数は取らない
- `--name` を省略した場合はディレクトリ名が project 名になる

## `loom fork`

既存 project を複製して、新しい一着の出発点にする。

```text
loom fork <source> <target> [--name name]
```

主な用途:

- 過去の一着をベースに別案を始める
- 元 project から独立した新しい作業ラインを作る

補足:

- fork 後の project は元 project と自動連動しない
- `--name` を省略した場合は target ディレクトリ名が project 名になる

## `loom add`

Valentina の `.val` を project の part として取り込む。

```text
loom add <file.val>
```

主な用途:

- `.val` を用意しただけの状態から、最初の part を作る
- `part.loom` を手で書かずに用意する

補足:

- `.val` から導出できない情報(name, type, variant, seam connector)は対話で尋ねる
- `parts/<name>/` に `.val` をコピーし、`part.loom` を生成する
- `loomit.yml` の `parts:` に登録するので、以後 `loom check` などが使える
- 質問はパイプでも与えられる(例: `loom add body.val < answers.txt`)

## `loom check`

project と part の整合性を検証する。

```text
loom check [path] [--format text|json]
```

主な用途:

- `loomit.yml` の構文や参照の確認
- connector や `requires` の互換診断
- build 前の基本チェック

補足:

- `path` を省略すると現在位置から project を探す
- 出力形式は `text` または `json`
- 仕上がり寸法ベースの互換性を扱い、geometry の rich check までは持たない

## `loom doctor`

`check` より詳しい診断説明を出す。

```text
loom doctor [path] [--format text|json]
```

主な用途:

- `check` の失敗理由を詳しく読みたいとき
- どの part や rule が問題なのかを追いたいとき

補足:

- 基本入力は `check` と同じ
- 「通るかどうか」より「どこが怪しいか」を読むためのコマンド

## `loom build`

参照 part を集めて `output/` に build 結果を書き出す。

```text
loom build [path] [--format text|json]
```

主な用途:

- build 用ディレクトリの作成
- manifest を含む出力の生成

補足:

- 実行前に project load、part resolve、`check` 相当の検証が走る
- 互換エラーがある場合は build しない

## `loom diff`

2つの part、または2つの project 内の同一 role part を比較して、意味のある設計差分を読む。

```text
loom diff <from-part.loom> <to-part.loom> [--format text|json]
loom diff <from-project> <to-project> --part <role> [--format text|json]
```

主な用途:

- branch 間で sleeve や body の変更を比較する
- raw file diff ではなく domain diff として読む
- keep / discard の判断材料を得る

補足:

- `--part <role>` を使うと project 同士の同じ role を比較できる
- darts 射影や prototype notes に関する診断も diff レポートに反映されることがある
- Loomit 本体では、`diff` は単なる比較表示ではなく design review surface として位置付けている

## `loom fit`

body profile と project を照合して、着用リスクを診断する。

```text
loom fit [path] --profile <name|path> [--format text|json]
```

主な用途:

- profile に対してきつすぎないかを見る
- garment の finished measurements と body profile を比較する

補足:

- `--profile` は必須
- profile 名を渡した場合は project の `profiles` 定義、または `profiles/<name>.yml` を解決する
- 断定ではなく risk / diagnostic を返す

## `loom suggest-tests`

現在の project で確認すべき movement test を提案する。

```text
loom suggest-tests [path] [--notes path] [--format text|json]
```

主な用途:

- 今回の服で見るべき動作シナリオを洗い出す
- prototype notes を踏まえた test 候補を出す

補足:

- `--notes` を省略した場合は `notes/prototype-notes.yml` を自動で探す
- notes が存在しなければ、notes なしで提案を続行する

## `loom test`

指定した movement test scenario に対するリスクを診断する。

```text
loom test <scenario> [path] [--notes path] [--format text|json]
```

主な用途:

- `arm-raise` など特定動作の確認
- suggestion で出たシナリオの個別チェック

補足:

- 最初の位置引数は scenario 名
- `--notes` を省略した場合は `notes/prototype-notes.yml` を自動で探す
- v0 では物理シミュレーションではなくルールベース診断を前提にする

## `loom publish`

作業中の part directory を Loomit library にコピーする。

```text
loom publish <part-path> [--library path] [--name name]
```

主な用途:

- 気に入った part を再利用資産として保存する
- project から library へ明示的に切り出す

補足:

- publish は自動ではなく明示操作
- `--library` を省略した場合は `~/.loomit/library`
- `--name` で library entry 名を上書きできる

## `loom library`

published part の一覧表示や project への追加を行う。

```text
loom library list [--library path] [--type type] [--format text|json]
loom library add <type/name> [project] [--library path] [--role role] [--as name] [--replace]
```

主な用途:

- library 内の part を一覧する
- library から project に part をコピーする

サブコマンド:

- `list`: library の一覧表示
- `add`: library part を project に追加

補足:

- `--role` は project 側での role 名を指定する
- `--as` は local directory 名を指定する
- `--replace` を付けると既存 role の置き換えを許可する
- `--library` を省略した場合は `~/.loomit/library`

## Output Formats

いくつかのコマンドは `--format text|json` を持つ。

- `text`: 人が terminal で読むための出力
- `json`: 他ツール連携やテストで扱いやすい構造化出力

現在 `--format` を持つ主なコマンド:

- `check`
- `doctor`
- `build`
- `diff`
- `fit`
- `suggest-tests`
- `test`
- `library list`

## Notes

- この辞書は、現時点の `packages/cli/src/commands/` にある実装済みコマンドを基準にしている
- 古い設計文書に登場する `graph` などは、まだこの辞書には含めていない
- 将来 `seamlint` や `truer` が別ツールとして育つ場合も、ここでは Loomit 本体の `loom` コマンドだけを扱う
