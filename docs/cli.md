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
- `slnt request`
- `slnt check`

## Notes

- コマンドの実装は `packages/cli/src/commands/` にある。
- Loomit は CLI を小さく、project 操作に絞って保つことを意図している。
