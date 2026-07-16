---
name: test-writing
description: "Add or change vitest tests and fixtures for Loomit (packages/*/test). The point is to pin diagnostic / check behavior with both a should-fire and a must-not-fire case, and to keep report contracts stable. Writing the implementation is loomit-implementation; reviewing a diff is code-review. The diagnostic shape / code / target contract and the canonical test rules live in loomit-implementation's testing-diagnostics reference (do not duplicate here)."
---

# Test Writing

Entry point for adding vitest tests and fixtures. Read the nearest existing test first and match its shape.

## Common

- Read the nearest `packages/*/test/*.test.ts` first and match naming and assertion style.
- When you change a diagnostic / check / report, add tests here (implementation is `loomit-implementation`).
- Do not loosen the implementation to fit a test. Keep finished-line semantics, core purity, and report contracts intact.

## Read first

- The nearest existing test under `packages/<pkg>/test/`, and fixtures under `packages/core/test/fixtures/`.
- **Canonical: `../loomit-implementation/references/testing-diagnostics.md`** — the test-comment rule, fixture guidance, `Diagnostic.code` / `message` / `target` contract, and slice completion. Do not duplicate it here.

## Steps

1. State the protected spec in one sentence (it becomes the test comment).
2. Choose placement and fixtures (testing-diagnostics.md: focused unit tests over domain objects, fixture tests over project directories under `packages/core/test/fixtures/`).
3. For a check / diagnostic, write both a should-fire fixture and a must-not-fire fixture; for either/or behavior, test and comment both meanings.
4. Keep `Diagnostic.code` assertions on the stable `UPPERCASE_SNAKE` code, not on display wording.
5. Run `pnpm test` (vitest), or `pnpm --filter <pkg> test` while iterating. If you cannot run it, say why.
