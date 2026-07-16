# Loomit Agent Rules

このファイルは、Loomit で常時守る最小ルールだけを定義する。

詳細な実装ルールはプロジェクト配下の skill `skills/loomit-implementation/` に分離している。Loomit のコード、schema、diagnostics、tests、CLI、実装計画に触るときは、その skill を使う。

## Read Only When Relevant

docs は総覧しない。今のタスクに必要なものだけ読む。

- schema、domain model、report shape、寸法や意味づけを変えるとき:
  `docs/architecture.md`
- `variant` / `requires` / `prototype-notes.yml` などの設計判断を触るとき:
  `docs/work/memo.md`
- 実装手順、package 境界、一般的な実装方針を確認するとき:
  `docs/work/implementation-guidelines.md`
- 書き込み、コピー、パス解決、errno、並行書き込み、`output/` を触るとき:
  `docs/work/operational-constraints.md`
- 今やる slice や完了条件を確認するとき:
  `docs/work/implementation-plan.md`
- 技術選定や cross-platform 方針を確認するとき:
  `docs/technology-selection.md`
- 縫い目ドメインの語彙(connector の id/type/side、band seam、coincident/contiguous、notch 署名)を確認するとき:
  `docs/core-concepts.md` と `docs/glossary.md`
- なぜ今の設計に至ったか(責務境界、seam=参加エッジの集合、assembly=tree、band)を確認するとき:
  `docs/design-history.md`

`docs/work/technical-plan.md` には旧設計の例が残っている。実装へコピーしない(具体例は skill の Minimal Workflow を参照)。

`loom diff` の役割や branch-driven な試作フローを確認するとき:
`docs/work/diffable-domain.md`

Loomit / Seamlint / Truer の責務分担を確認するとき:
`docs/design-history.md`(§「責務境界が落ち着いた」で確定)

## Required Project Skill

次の作業では `skills/loomit-implementation/` を読む。

- Loomit の実装に入るとき。
- `packages/` 配下のコードを作成または変更するとき。
- `loomit.yml`、`part.loom`、`prototype-notes.yml` などの schema を扱うとき。
- diagnostics / reports / CLI output を扱うとき。
- tests / fixtures を追加または変更するとき。
- `docs/work/implementation-plan.md` の slice を進めるとき。

## Non-Negotiables

- 実装ルールは `skills/loomit-implementation/` と、その task に関連する docs に従う。
- テストには、守る仕様をコメントで必ず明示する。
- `any`、`unknown`、明示的な `undefined` 型は無断使用禁止。意図的に使う場合は理由コメントを必ず書く。
- `variant` を software version として大小比較しない。
- `requires` を version range として扱わない。
- `length_mm` は仕上がり線上の寸法として扱う。
- core は CLI / Studio に依存しない。

## Before Starting Work

- 今やる作業に必要な docs だけ読む。
- slice を進める作業なら `docs/work/implementation-plan.md` の対象 slice と完了条件を確認する。
- task に応じて `skills/loomit-implementation/references/` を読む。

## Before Finishing Work

- 対応する slice の完了条件を満たしているか確認する。
- 対応する unit test または fixture test が green か確認する。
- `pnpm typecheck` と `pnpm test` を実行する。実行できない場合は理由を残す。
- docs と実装が矛盾していないか確認する。
