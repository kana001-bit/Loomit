# Loomit Agent Rules

このファイルは、Loomit で常時守る最小ルールだけを定義する。

詳細な実装ルールはプロジェクト配下の skill `.claude/skills/loomit-implementation/` に分離している。Loomit のコード、schema、diagnostics、tests、CLI、実装計画に触るときは、その skill を使う。

## Loomit とは (1 行)

洋裁パターンのプロジェクト（part・connector/seam・variant・assembly tree・band）をモデル化し、
`loom check`（互換性・fit 診断）/ `loom diff`（branch 駆動の試作）を回す道具。**幾何の計測は
Seamlint、型紙の線の整形（乱れた線をきれいに書き直す formatter）は Truer**、Loomit は
project model・互換性・最終 check 集約を担う。

> 責務境界（Loomit / Seamlint / Truer）の正本は `docs/design-history.md`（§「責務境界が落ち着いた」）。
> core は CLI / Studio に依存しない純粋層に保つ。ドメイン語彙・非交渉ルールは下記と skill を参照。

## 読み方

- docs は総覧しない。どの docs をいつ読むかは `.claude/skills/loomit-implementation/` の
  「Task-Based Reading」に集約する（AGENTS には複製しない）。
- `docs/work/technical-plan.md` の旧設計例は実装へコピーしない。

## Required Project Skill

次の作業では `.claude/skills/loomit-implementation/` を読む。

- Loomit の実装に入るとき。
- `packages/` 配下のコードを作成または変更するとき。
- `loomit.yml`、`part.loom`、`prototype-notes.yml` などの schema を扱うとき。
- diagnostics / reports / CLI output を扱うとき。
- tests / fixtures を追加または変更するとき。
- `docs/work/implementation-plan.md` の slice を進めるとき。

## Other Project Skills

Read the matching skill before starting these recurring tasks (each skill's `description` has the boundary):

- Reviewing a diff or PR before merge → `.claude/skills/code-review/SKILL.md`
- Adding or changing vitest tests / fixtures → `.claude/skills/test-writing/SKILL.md`
- A long, cross-session or cross-branch task spec (confirmed vs open, with evidence) → `.claude/skills/task-spec-manager/SKILL.md`
- A branch-scoped plan / progress / handoff note → `.claude/skills/branch-worklog/SKILL.md`

## Non-Negotiables

- 実装ルールは `.claude/skills/loomit-implementation/` と、その task に関連する docs に従う。
- テストには、守る仕様をコメントで必ず明示する。
- `any` 型は使わない。型が不明なら `unknown` を使い使用箇所で絞り込む。`unknown` は信頼できない入力の境界と catch した `error` に限り無コメント可、それ以外の意図的な `unknown` 使用は理由コメントを添える。`T | undefined` のユニオン型は「不在を正直に表す型」として推奨し、コメント不要。
- `variant` を software version として大小比較しない。
- `requires` を version range として扱わない。
- `length_mm` は仕上がり線上の寸法として扱う。
- core は CLI / Studio に依存しない。

## Before Starting Work

- 今やる作業に必要な docs だけ読む。
- slice を進める作業なら `docs/work/implementation-plan.md` の対象 slice と完了条件を確認する。
- task に応じて `.claude/skills/loomit-implementation/references/` を読む。

## Before Finishing Work

- 対応する slice の完了条件を満たしているか確認する。
- 対応する unit test または fixture test が green か確認する。
- `pnpm typecheck` と `pnpm test` を実行する。実行できない場合は理由を残す。
- docs と実装が矛盾していないか確認する。
