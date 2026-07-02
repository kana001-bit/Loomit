# Loomit Agent Rules

このファイルは、Loomit で常時守る最小ルールだけを定義する。

詳細な実装ルールはプロジェクト配下の skill `skills/loomit-implementation/` に分離している。Loomit のコード、schema、diagnostics、tests、CLI、実装計画に触るときは、その skill を使う。

## Primary References

実装時は次の順に参照する。

1. `docs/architecture.md`
2. `docs/technology-selection.md`
3. `docs/implementation-guidelines.md`
4. `docs/implementation-plan.md`
5. `docs/memo.md`

`docs/technical-plan.md` には旧設計の例が残っている可能性がある。特に `version: 3` や `requires: ">=4"` のような旧 schema 例を実装へコピーしない。

## Required Project Skill

次の作業では `skills/loomit-implementation/` を読む。

- Loomit の実装に入るとき。
- `packages/` 配下のコードを作成または変更するとき。
- `loomit.yml`、`part.loom`、`prototype-notes.yml` などの schema を扱うとき。
- diagnostics / reports / CLI output を扱うとき。
- tests / fixtures を追加または変更するとき。
- `docs/implementation-plan.md` の slice を進めるとき。

## Non-Negotiables

- 着手順は `docs/implementation-plan.md` に従う。
- 実装ルールは `docs/implementation-guidelines.md` と `skills/loomit-implementation/` に従う。
- テストには、守る仕様をコメントで必ず明示する。
- `any`、`unknown`、明示的な `undefined` 型は無断使用禁止。意図的に使う場合は理由コメントを必ず書く。
- `variant` を software version として大小比較しない。
- `requires` を version range として扱わない。
- `length_mm` は仕上がり線上の寸法として扱う。
- core は CLI / Studio に依存しない。

## Before Starting Work

- 今やる作業が `docs/implementation-plan.md` のどの slice か確認する。
- その slice の完了条件を確認する。
- 必要なら `skills/loomit-implementation/references/` を読む。

## Before Finishing Work

- 対応する slice の完了条件を満たしているか確認する。
- 対応する unit test または fixture test が green か確認する。
- `pnpm typecheck` と `pnpm test` を実行する。実行できない場合は理由を残す。
- docs と実装が矛盾していないか確認する。
