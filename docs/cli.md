# Loomit CLI Dictionary

この文書は、`loom` コマンドが何をするか・いつ使うかをまとめたコマンド辞書である。

## Overview

Loomit の CLI は、大きく次のワークフローに分かれる。

- project を作る・複製する: `init`, `fork`
- part を追加する・再利用する: `add`, `publish`, `library`
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
loom add <file.val>
```

挙動:

- `.val` から `<detail>` ピースを検出したら、**ピースごとに part を1つ** scaffold する。
- 生成した part は `parts/<role>/` に書き出す。
- 生成した各 `part.loom` は `files.source`（共有 `.val`）と `files.piece`（担当する detail 名）を記録する。
- `<draw>` はあるが `<detail>` が1つも無い `.val`（construction のみ）は、案内を表示して何も追加せずに終了する。
- draw も detail も検出できない `.val` は、従来どおり単一 part の対話に倒す。

対話で尋ねる項目:

- detail 単位の add: `role`, `name`, `type`, `variant`, seam connector
- 従来の単一 part の add: `name`, `type`, `variant`, seam connector

補足:

- `role` は project 側の part identity（例: `front`, `back`, `upper_sleeve`）で、`loomit.yml` の parts key かつ `parts/<role>/` のディレクトリになる。パス segment 制約がある。
- `type` は粗分類（例: `body`, `sleeve`）で、role とは別軸。同じ type のピースが複数あってよい。
- `name` は part.loom のラベルで、パスにもキーにも使わない。安全 segment 制約は課さないので、空白や日本語も使える。
- 質問はパイプでも与えられる（例: `loom add body.val < answers.txt`）。
- 取り込み後は `loom check` を実行する。

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

## `loom diff`

2つの part、または2つの project 内の同一 role part を比較する。

```text
loom diff <from-part.loom> <to-part.loom> [--format text|json]
loom diff <from-project> <to-project> --part <role> [--format text|json]
```

補足:

- raw file diff ではなく、ドメインを踏まえた変更として読む。
- connector や requirement について recheck のヒントを含める。

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

## `loom publish`

part ディレクトリを Loomit library に publish する。

```text
loom publish <part-path> [--library path] [--name name]
```

補足:

- 既存の part から再利用可能な library entry を切り出す（自動ではなく明示操作）。

## `loom library`

published part を一覧する、または project に追加する。

```text
loom library list [--library path] [--type type] [--format text|json]
loom library add <type/name> [project] [--library path] [--role role] [--as name] [--replace]
```

補足:

- `list` は library 内の part を一覧する。
- `add` は published part を project にコピーする。

## Output Formats

次のコマンドは `--format text|json` を持つ。

- `check`
- `doctor`
- `build`
- `diff`
- `fit`
- `suggest-tests`
- `test`
- `library list`

## Notes

- コマンドの実装は `packages/cli/src/commands/` にある。
- Loomit は CLI を小さく、project 操作に絞って保つことを意図している。
