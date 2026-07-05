# Development

## Development Workflow

この project の方向性、ドメインモデリング、schema の判断、設計上の tradeoff は作者が決める。
AI は、その判断のもとでの実装レバレッジとして、コード記述・レビュー・リファクタリングに使う。

その作業に課している設計基準（core / CLI 分離、型の扱い、診断の規約、`variant` を version として比較しない、`length_mm` は仕上がり寸法として扱う、など）は [`../AGENT.md`](../AGENT.md) にまとめている。設計がどう変化し、なぜ判断が変わったかは [`design-history.md`](design-history.md) に記録している。

## Checks

変更を終える前に次を実行する。

```bash
pnpm typecheck
pnpm test
pnpm lint
```
