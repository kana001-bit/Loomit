# Loomit Technology Selection

この文書は、Loomit v0 の技術選定を定義する。

目的は、最初から大きな統合アプリを作ることではなく、信頼できる core と CLI を作り、`loom check` を実用可能にすることである。

> パッケージ構成、`core` / `cli` の責務分担と依存方向、`Diagnostic` のデータ構造は [`architecture.md`](architecture.md) を正とする。本文書はツール・ライブラリ・バージョンの選定に絞り、それらを二重に定義しない。

## 選定方針

- CLI とファイルベースを最優先にする。
- core は UI や CLI 表示に依存しない。
- 正本は `loomit.yml`、`part.loom`、`prototype-notes.yml` などのテキストファイルに置く。
- Windows でも扱いやすい標準的な Node.js / TypeScript 構成にする。
- v0 では plugin runtime、DB、Studio を作り込まない。
- 迷ったら、依存を増やすより core の境界と診断品質を優先する。

## 採用技術

| 領域 | 採用 | 理由 |
| --- | --- | --- |
| Runtime | Node.js LTS | CLI、ファイル操作、JSON/YAML処理、将来のVite UIと相性がよい。 |
| Language | TypeScript | core API、diagnostics、schema、rule の型を明確にできる。 |
| Package manager | pnpm | workspace 運用がしやすく、monorepo 構成に向く。 |
| Monorepo | pnpm workspaces | `packages/core`、`packages/cli`、将来の `packages/studio` を分けられる。 |
| Build | TypeScript compiler (`tsc`) | v0 では bundle より型検査と安定性を優先する。 |
| CLI framework | Commander | サブコマンド、help、引数処理を薄く実装できる。 |
| YAML parser | `yaml` | YAML の parse/stringify とコメント保持の将来余地がある。 |
| Runtime schema validation | Zod | `loomit.yml` / `part.loom` の入力検証を型と近い形で書ける。 |
| Test runner | Vitest | TypeScript との相性がよく、unit test を軽く始められる。 |
| Formatter | Prettier | コード整形の判断を自動化し、議論を減らす。 |
| Linter | ESLint | TypeScript の基本的な静的検査を行う。 |
| UI later | React + Vite | Studio を作る段階で採用候補にする。v0 core/CLI では不要。 |

## Node.js バージョン

v0 では Node.js LTS を対象にする。

推奨:

```text
node >= 24
```

理由:

- 2026年時点で Node.js 24 は LTS 系列である。
- 新規プロジェクトとして、古い Node 互換性より保守しやすさを優先する。
- 将来 Vite / React Studio を追加しても問題になりにくい。

実装開始時は `package.json` に次のように明記する。

```json
{
  "engines": {
    "node": ">=24"
  }
}
```

## データ形式

正本ファイル（`loomit.yml`、`part.loom`、`notes/prototype-notes.yml`、`profiles/*.yml`）は YAML を採用する。

- 手で読める。
- Git diff で追いやすい。
- Studio がなくても編集できる。
- コメントや reason を残しやすい。

JSON は内部 report や `--format json` の出力に使う。

## バリデーション

ファイルを読むときは parse と validation を分ける。runtime のスキーマ検証には Zod を採用し、schema は `core` に置く。

```text
packages/core/src/schema/
  project.schema.ts
  part.schema.ts
  profile.schema.ts
  prototype-notes.schema.ts
```

Zod の生エラーはそのまま CLI に出さず、Loomit の `Diagnostic` に変換する。data model の内容（`name` と `variant` の分離、`variant` を大小比較しない、`requires` は寸法・タグ・素材の直接条件、`length_mm` は仕上がり寸法、など）は [`architecture.md`](architecture.md) を正とする。

## Testing

v0 のテストは Vitest で始める。

優先するテスト:

- schema validation
- path resolution
- compatibility rule
- diagnostics generation
- CLI formatting
- fixture-based project loading

最初から E2E を厚くしすぎない。core の unit test と fixture test を優先する。

## 保留する技術

### SQLite

v0 では採用しない。

必要になる条件:

- タグ検索が増えた
- Studio で大量のパーツ一覧を扱う
- 履歴検索を高速化したい

採用する場合も、DB は正本ではなくキャッシュまたはインデックスとする。

### React / Vite

Studio フェーズまで保留する。

core / CLI の境界が安定する前に UI を作ると、UI 側の都合が domain model を歪めやすい。

### Plugin Runtime

v0 では実装しない。

まずは core 内の rule registry として実装する。

```text
core/compatibility/rules/
core/fit/rules/
core/movement-tests/rules/
```

外部 plugin API は、内部 rule の形が固まってから設計する。

### Bundler

v0 では `tsc` を基本にする。

CLI 配布時に起動速度や単一ファイル配布が必要になったら、`tsup` などを再検討する。

## 非採用

### GUI first

採用しない。

Loomit の価値は、まず `loom check` が信頼できることにある。GUI は入口とデバッグ支援として後から追加する。

### DB first

採用しない。

Git diff とローカルファイルの可読性を優先する。

### Full CAD Engine

採用しない。

v0 では外部 CAD の出力を扱う。Loomit 内で本格的な型紙編集や図形生成をしない。

### Physics Simulation

採用しない。

fit / movement test は、まずルールベース診断として実装する。

## 初期 `package.json` 方針

root:

```json
{
  "private": true,
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "format": "prettier --write .",
    "lint": "eslint ."
  }
}
```

`packageManager` は実装開始時に、実際に使う pnpm の正確なバージョンで固定する。

```json
{
  "packageManager": "pnpm@<fixed-version>"
}
```

## 参考

- Node.js previous releases: https://nodejs.org/en/about/previous-releases
- TypeScript documentation: https://www.typescriptlang.org/docs/
- pnpm workspaces: https://pnpm.io/workspaces
- Commander: https://github.com/tj/commander.js
- yaml package: https://eemeli.org/yaml/
- Zod: https://zod.dev/
- Vitest: https://vitest.dev/
- Prettier: https://prettier.io/docs/
- ESLint: https://eslint.org/
- Vite: https://vite.dev/
