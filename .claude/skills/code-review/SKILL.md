---
name: code-review
description: "Review a Loomit working diff or PR before merge for safety — do not write code here. Focus on: report/schema contract breaks, variant-as-version and requires-as-range misuse, finished-line (length_mm) semantics, core independence from CLI/Studio, file I/O safety under output/, any/unknown hygiene, and stale comments. Writing the implementation is loomit-implementation; adding tests is test-writing (here you point out gaps, you do not write)."
---

# Loomit Code Review

Entry point for reviewing a diff. This skill sticks to pointing out issues (it does not write code). Loomit regenerates pattern artifacts from a project model, so review that reports and contracts stay stable and that measurements stay honest (finished-line semantics) — not just that the code compiles.

## Read first

- The diff under review (`git diff` / the PR). Split the change surface first:
  schema / domain model / diagnostics / reports / CLI output / compatibility rules / filesystem writes under `output/`.
- `../loomit-implementation/references/implementation-rules.md` — module boundaries and the implementation policy the diff must respect.
- `../loomit-implementation/references/testing-diagnostics.md` — the diagnostic `code` / `message` / `target` and report contract when the diff touches diagnostics or reports.

## Review order

1. **Report / schema contract.** Are `Diagnostic` / `CheckReport` / `FitReport` fields renamed or reshaped without an explicit break? They are shared with the future Studio. Is `Diagnostic.code` still stable `UPPERCASE_SNAKE` and English (no locale baked into `code`)? Are display-only wording changes kept in formatters, not core?
2. **Domain semantics (the heavy ones).** Is `variant` compared as a software version, or `requires` treated as a version range? Both are banned. Is `length_mm` treated as a finished-line dimension? Is a connector id still the shared rendezvous key (one seam can join more than two parts under one id)?
3. **Core independence.** Does `core` reach into CLI / Studio / `process` / the filesystem where it must stay pure? Reports must be buildable without the CLI.
4. **File I/O safety.** Are writes contained under the resolved allowed root (no `..` escape)? Is `output/` treated as a regenerable, Loomit-managed area, and are single-writer assumptions not silently broken?
5. **Type hygiene.** No `any`; `unknown` only at untrusted-input boundaries and caught errors; other intentional `unknown` justified; `T | undefined` preferred for honest absence.
6. **Stale comments (rot).** Did the diff change behavior / schema / invariants while a comment or docstring still describes the old behavior? Safety or contract claims that lost their guarantee are the heaviest kind. Also finished TODOs and dead path / symbol references. Point them out and clean them up (align the comment to the code, or delete it — do not leave a lie).

## Drop false positives (separate proposing from disproving)

- State every finding as a concrete breaking scenario (input → wrong output / contract break / lost or clobbered file). Drop findings you cannot write a scenario for.
- Try to disprove each finding once: check whether existing code or tests already prevent it before keeping it.
- Confine heavy diffs, raw data, and wide investigation to a nested subagent; return only the confirmed findings to the main thread.
- Do not mass-produce style preferences or unrequested refactors. Rank by severity (correctness > contract > simplicity).

## Verify

- For a finding you suspect changes behavior, reproduce it with `pnpm test` (vitest) or a focused unit / fixture test before confirming.
- When a mechanical diff pass helps, run the built-in `/code-review` first and layer these Loomit-specific checks on top.

## Do not

- Rewrite the implementation itself (that is `loomit-implementation`).
- Create new tests (that is `test-writing`). Here, point out missing coverage only.
