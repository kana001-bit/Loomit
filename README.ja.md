# Loomit

[![CI](https://github.com/kana001-bit/Loomit/actions/workflows/ci.yml/badge.svg)](https://github.com/kana001-bit/Loomit/actions/workflows/ci.yml)

反復的な型紙づくりのための、Git ライクなワークフロー。

_English version: [`README.md`](README.md)_

## What is Loomit?

Loomit は、型紙づくりに Git ライクなワークフローを持ち込むローカルファースト CLI です。設計の反復管理、互換性の検証、意味のある変更の記録、パーツの再利用に注力し、CAD 編集は Valentina のような外部ツールに任せます。

## Status

まだ初期段階・ローカルファースト。スコープは正直に書きます。

- **今できること** — 互換 `check`、意味的 `diff`（Git revision 間の差分も。例: `loom diff main..HEAD --part body`）、fit / movement-test 診断、パーツ再利用（`fork`, `publish`, `library`）。
- **Git に委譲（設計判断）** — snapshot・branch・履歴。Loomit の正本はテキスト（`loomit.yml`, `part.loom`）なので、プロジェクトは Git リポジトリの中で自然に動きます。`loom diff` は任意の2版を**洋裁レベルの設計変更**として読み、バージョン管理は再実装しません。
- **これから** — `fit` ルールの拡充、diff の説明力向上、Loomit Studio（UI）。

## Motivation

服作りでは、問題が見つかるのが遅すぎることがよくあります——縫うと合わないパーツ、小さな変更のたびの試作やり直し、何をなぜ変えたか分からなくなる、など。Loomit は試作を、より意図的で、説明可能で、無駄の少ないものにします。

## Example

布を裁つ前に、一着のパーツがまだ縫い合わせられるかを確認します。

```console
$ loom check my-blouse
Loomit check: ok

Compatibility:
  [ok] connector-length body.armhole -> sleeve.armhole
  [ok] requirement-range body.requires.sleeve.armhole.length_mm -> sleeve.armhole.length_mm
  [ok] requirement-range sleeve.requires.body.armhole.length_mm -> body.armhole.length_mm
```

シームが合わなくなったときは、「×」だけでなく理由つきで検出します。

```console
$ loom check my-blouse            # exit code 1
Loomit check: error

Compatibility:
  [error] connector-length body.armhole -> sleeve.armhole
  [error] CONNECTOR_LENGTH_MISMATCH sleeve.armhole
    コネクタの仕上がり線の長さが許容差を超えています。/ Connector finished seam lengths exceed the tolerance.
    suggestion: body.armhole and sleeve.armhole differ by 11mm; allowed tolerance is 3mm.
  …
```

診断は構造化データです。人向けには日英併記、CI 向けには `--format json` と非0 exit code を返します。`loom doctor` は同じ内容を文章で説明します。各チェックは「何を保証しないか」も明示します（[Core Concepts](docs/core-concepts.md)）。

## For People Who Make Clothes

→ [`docs/vision.md`](docs/vision.md)

## For Developers

Loomit は pnpm monorepo です。`@loomit/core` がドメインロジック（schema 検証、compatibility / fit / movement ルール、semantic diff、構造化レポート）を持ち、CLI には依存しません。`@loomit/cli` は core の診断を text / JSON に整形する薄い adapter です。TypeScript + Zod schema + Vitest で書かれています。責務境界は [Architecture](docs/architecture.md)、ドメインモデルは [Core Concepts](docs/core-concepts.md) を参照してください。

## Quick Start

必要なもの: Node.js 24+ と `pnpm`。

```bash
pnpm install
pnpm build
pnpm test
```

コマンドの使い方と実行例は [Tutorials](docs/tutorials.md) にあります。

## Documentation

### Getting Started

- [Tutorials](docs/tutorials.md) — 実行例: プロジェクトの検証、2 revision の diff
- [CLI Reference](docs/cli.md) — `loom` CLI のコマンド辞書
- [Core Concepts](docs/core-concepts.md) — ドメインモデル: parts, connectors, requirements, prototype notes

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
