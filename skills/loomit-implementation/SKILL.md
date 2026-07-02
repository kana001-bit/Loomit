---
name: loomit-implementation
description: Project-specific Loomit implementation guidance. Use when Codex or another coding agent is implementing or modifying Loomit code, schemas, diagnostics, tests, CLI behavior, project structure, or AGENT/docs rules; when following docs/implementation-plan.md slices; or when checking Loomit-specific architecture constraints such as variant vs version, finished measurements, prototype notes, and core/CLI separation.
---

# Loomit Implementation

Use this skill when working on Loomit implementation tasks. It keeps detailed project-specific rules out of the always-loaded `AGENT.md` while preserving the guardrails needed during coding.

## Required Workflow

1. Read the relevant project docs before coding:
   - `docs/architecture.md` for the v0 data model and architecture.
   - `docs/implementation-plan.md` for the current slice and completion criteria.
   - `docs/implementation-guidelines.md` for implementation rules.
   - `docs/memo.md` for decisions about version/variant, fork, and prototype notes.
2. Do not use old schema examples from `docs/technical-plan.md` as implementation source. It may still contain legacy `version: 3` or `requires: ">=4"` examples.
3. Identify the active implementation slice before editing code.
4. Implement only the smallest useful slice.
5. Add or update tests with explicit `守る仕様:` comments.
6. Before finishing, run the slice's required checks, or state why they could not be run.

## Reference Files

Read these references only when relevant:

- `references/implementation-rules.md`: core/CLI separation, type safety, side effects, file I/O, design-decision comments, and docs precedence.
- `references/testing-diagnostics.md`: test-comment rules, fixture tests, diagnostics/report compatibility, message/code/target conventions, and slice completion checks.

## Non-Negotiables

- `variant` is an identifier, not an ordered software version.
- `requires` is direct constraints over measurements/tags/material conditions, not a software version range.
- `length_mm` is a finished seam-line measurement, not a cutting measurement with seam allowance.
- `prototype-notes.yml` is intentionally separate from `loomit.yml` because it represents reusable learning data.
- Core does not print, exit, write stdout/stderr, or make pure rule checks depend on time/random/filesystem access.
