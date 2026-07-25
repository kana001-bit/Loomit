# Loomit

[![CI](https://github.com/kana001-bit/Loomit/actions/workflows/ci.yml/badge.svg)](https://github.com/kana001-bit/Loomit/actions/workflows/ci.yml)

型紙づくりのための Git ライクな CLI——差分を座標ではなく「縫製の判断」として読みます。

_English version: [`README.md`](README.md)_

## What is Loomit?

Loomit は、型紙づくりに Git ライクなワークフローを持ち込むローカルファースト CLI です。設計の反復管理、互換性の検証、意味のある変更の記録、パーツの再利用に注力し、CAD 編集は Valentina（型紙 CAD）のような外部ツールに任せます。

服作りでは、問題が見つかるのが遅すぎることがよくあります——縫うと合わないパーツ、小さな変更のたびの試作やり直し、何をなぜ変えたか分からなくなる、など。Loomit は試作を、より意図的で、説明可能で、無駄の少ないものにします。

最小限の用語——**パーツ**＝型紙1枚、**コネクタ**＝2枚のパーツが縫い合わさる継ぎ目、**ダーツ**＝布を摘まんで体に沿わせる縫い込み。

_作る人は [Vision](docs/vision.md) から。開発者は [Architecture](docs/architecture.md) と下の [For Developers](#for-developers) へ。_

## What a change looks like

型紙のパーツはプレーンテキストなので、普通の Git リポジトリの中に置けます。そして `git diff` が「どの行が動いたか」を見せるのに対し、`loom diff` は同じ2版を読み、その変更が**服に何をするか**を答えます——だからコミットは座標の塊ではなく「ウエストのダーツを詰めた」という縫製の判断になります。

下の例はウエストのダーツを詰めた変更です。読み取れるのは `volume change: reduced`（ボリューム減）と `connection risk: none`（縫い合わせは維持）です（初回は `pnpm install && pnpm build`）:

```console
$ node packages/cli/dist/main.js diff examples/waist-dart/bodice-v1.part.loom examples/waist-dart/bodice-v2.part.loom
Loomit diff: changed
From: bodice-front@fitted (body)
To:   bodice-front@fitted (body)

Summary:
  silhouette impact: medium
  volume change:     reduced
  connection risk:   none
  prototype notes:   none

Recheck Hints:
  part role: body
  connectors: none
  requirements: none

Changes:
  [modified] dart waist_front
    - width_mm: 30 -> 35
    - intake_length_mm: 110 -> 120
```

`connection risk: none` は、変更後もパーツがまだ縫い合わさることを意味します。同じ読み取りは Git の履歴に対しても働きます（`loom diff main..HEAD --part body`）。これは「型紙のバージョン管理」という大きな目標の一部ですが、**クローン直後から、Valentina も `.val` も無しで今日動く**一部です。

## Status

まだ初期段階・ローカルファースト。スコープは正直に書きます。

- **今できること** — 互換 `check`、意味的 `diff`（Git revision 間の差分も。例: `loom diff main..HEAD --part body`）、fit / movement-test 診断、一着まるごとの複製（`fork`）。
- **Git に委譲（設計判断）** — snapshot・branch・履歴。Loomit の正本はテキスト（`loomit.yml`, `part.loom`）なので、プロジェクトは Git リポジトリの内で動きます。`loom diff` は任意の2版を**洋裁レベルの設計変更**として読み、バージョン管理は再実装しません。
- **これから** — `fit` ルールの拡充、diff の説明力向上、Loomit Studio（UI）。

## Example

布を裁つ前に、一着のパーツがまだ縫い合わせられるかを確認します。同梱の `examples/blouse` は、armhole（袖ぐり）が合う body と sleeve を持っています:

```console
$ node packages/cli/dist/main.js check examples/blouse
Loomit check: ok

Compatibility:
  [ok] connector-length body.armhole -> sleeve.armhole
  [ok] requirement-range body.requires.sleeve.armhole.length_mm -> sleeve.armhole.length_mm
  [ok] requirement-range sleeve.requires.body.armhole.length_mm -> body.armhole.length_mm
```

sleeve の `length_mm` を 481 にして再実行すると、不一致は「×」だけでなく理由つきで、**2つの独立したチェック**が別々の観点で検出します——`CONNECTOR_LENGTH_MISMATCH`（body.armhole と sleeve.armhole が 12mm 差、許容 3mm）と `REQUIREMENT_RANGE_UNSATISFIED`（sleeve.armhole.length_mm が 481、要求は 466–472）。

診断は構造化データで、人向けには日英併記、CI 向けには `--format json`（非0 exit code）を返します。`loom doctor` は同じ内容を文章で説明します。各チェックは「何を保証しないか」も明示します（[Core Concepts](docs/core-concepts.ja.md)）。

## For Developers

Loomit は pnpm monorepo です。`@loomit/core` がドメインロジック（schema 検証、compatibility / fit / movement ルール、semantic diff、構造化レポート）を持ち、CLI には依存しません。`@loomit/cli` は core の診断を text / JSON に整形する薄い adapter です。TypeScript + Zod schema + Vitest で書かれています。責務境界は [Architecture](docs/architecture.md)、ドメインモデルは [Core Concepts](docs/core-concepts.ja.md) を参照してください。

## How This Was Built

Loomit は、私がディレクションし、AI コーディングエージェントに実装させて作っています。設計・アーキテクチャ・ドメインモデリング、そしてすべての判断は私のもので、エージェントは私が定めたルールの下でコードを書いています。そのルールは [`AGENTS.md`](AGENTS.md)——明文化した私の設計規約——にまとまっています（例: `core` は CLI に依存しない / `variant` はバージョンとして比較しない / `length_mm` は常に仕上がり寸法）。設計の理由、そして後から覆した判断とその理由は [Design History](docs/design-history.md) に記録しています。

## Quick Start

必要なもの: Node.js 24+ と `pnpm`。

```bash
pnpm install
pnpm build
pnpm test
```

その後は同梱の example で試せます（Valentina も `.val` も不要。`pnpm loom` は `node packages/cli/dist/main.js` のショートカットです）:

```console
$ node packages/cli/dist/main.js diff examples/waist-dart/bodice-v1.part.loom examples/waist-dart/bodice-v2.part.loom
```

コマンドの使い方と実行例は [Tutorials](docs/tutorials.md) にあります。

### Bring your own pattern

上の example はプレーンテキストなので、`check` と `diff` は外部ツール無しで動きます。実際の Valentina パターンから始める場合は、パーツに `.val` ソースと書き出した幾何を紐付けます——これはもう少し手間のかかる経路で、まだ整備中です。パーツがソースをどう参照するかは [Core Concepts](docs/core-concepts.ja.md) を参照してください。

## Documentation

はじめて読むなら、[Core Concepts](docs/core-concepts.ja.md) でドメインモデルを掴んでから [Tutorials](docs/tutorials.md) で動かすのが最短です。設計判断がどう下され、どれを後から覆したかは [Design History](docs/design-history.md) を読んでください。

### Getting Started

- [Tutorials](docs/tutorials.md) — 実行例: プロジェクトの検証、2 revision の diff
- [CLI Reference](docs/cli.md) — `loom` CLI のコマンド辞書
- [Core Concepts](docs/core-concepts.ja.md) — ドメインモデル: parts, connectors, requirements, prototype notes

### Design

- [Why Loomit Exists](docs/why.md) — なぜこの project を始めたのか、どんな困りごとから来ているか
- [Vision](docs/vision.md) — Loomit がどこを目指すか
- [Architecture](docs/architecture.md) — core / CLI / Studio の責務境界、データモデル、ツール境界
- [Design History](docs/design-history.md) — 設計がどう変化し、なぜ判断が変わったか
- [Technology Selection](docs/technology-selection.md) — monorepo と tooling の技術選定

### Development

- [Development](docs/development.md) — この project の作り方と、守っている基準

## License

[MIT](LICENSE) © 2026 kana001-bit
