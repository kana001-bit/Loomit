# Development

## Development Workflow

この project の方向性、ドメインモデリング、schema の判断、設計上の tradeoff は作者が決める。
AI は、その判断のもとでの実装レバレッジとして、コード記述・レビュー・リファクタリングに使う。

その作業に課している設計基準（core / CLI 分離、型の扱い、診断の規約、`variant` を version として比較しない、`length_mm` は仕上がり寸法として扱う、など）は [`../AGENTS.md`](../AGENTS.md) にまとめている。設計がどう変化し、なぜ判断が変わったかは [`design-history.md`](design-history.md) に記録している。

## Running the CLI locally

開発中は `node packages/cli/dist/main.js <command>` の代わりに、repo root から短い script で実行できる。
install / publish / global link は不要で、Windows・macOS・Linux で同じ運用になる。

```bash
pnpm build                       # 初回、またはソース変更後に dist を更新
pnpm loom check path/to/project  # = node packages/cli/dist/main.js check path/to/project
pnpm loom build path/to/project
pnpm loom --help
```

`check` / `build` / `diff` / `fit` / `doctor` / `test` は対象プロジェクトを path 引数で受け取るので、
repo root から実行して引数で指定する。ソースを変更したら dist が古くなる。ビルドと実行をまとめたい
ときは `loom:fresh` を使う。

```bash
pnpm loom:fresh check path/to/project   # 全 package を build してから実行
```

なお `loom init` は「現在のディレクトリ」を初期化する(git init 方式で path 引数を取らない)。
`pnpm loom init` を repo root で実行すると repo 自体を初期化してしまうため、新規プロジェクトを作る
ときは対象ディレクトリで組み込み済み CLI を直接呼ぶ。

```bash
cd path/to/new-project
node /abs/path/to/Loomit/packages/cli/dist/main.js init
```

どのディレクトリでも実 `loom` コマンドとして使いたい場合は global link を張る(rebuild で反映)。

```bash
pnpm --filter @loomit/cli build
cd packages/cli && pnpm link --global   # loom がどこでも使える / 解除: pnpm unlink --global
```

## Checks

変更を終える前に次を実行する。

```bash
pnpm typecheck
pnpm test
pnpm lint
```
