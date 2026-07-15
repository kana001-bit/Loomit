---
name: loomit-implementation
description: Project-specific Loomit implementation guidance. Use when Codex or another coding agent is implementing or modifying Loomit code, schemas, diagnostics, tests, CLI behavior, project structure, or AGENT/docs rules; when following docs/work/implementation-plan.md slices; or when checking Loomit-specific architecture constraints such as variant vs version, finished measurements, prototype notes, and core/CLI separation.
---

# Loomit Implementation

Use this skill when working on Loomit implementation tasks. It keeps detailed project-specific rules out of the always-loaded `AGENT.md` while preserving the guardrails needed during coding.

## Minimal Workflow

1. Read only the docs needed for the current task.
2. Do not use old schema examples from `docs/work/technical-plan.md` as implementation source. It may still contain legacy `version: 3` or `requires: ">=4"` examples.
3. If the task is part of a planned slice, identify the active slice before editing code.
4. Implement only the smallest useful slice.
5. Add or update tests with explicit `守る仕様:` comments.
6. If you add, remove, rename, or materially change a CLI command or its user-facing behavior, update `docs/cli.md` in the same change.
7. Review the diff for stale comments: any comment, doc line, or skill example that describes behavior you just changed must be updated or deleted. See `references/implementation-rules.md` "Stale Comments".
8. Before finishing, run the task's required checks, or state why they could not be run.

## Task-Based Reading

Open only the relevant docs:

- `docs/work/implementation-plan.md`: when choosing a slice, following the roadmap, or checking completion criteria.
- `docs/architecture.md`: when changing schema, domain model, reports, dimensions, or other source-of-truth structures.
- `docs/work/memo.md`: when touching `variant`, `requires`, `prototype-notes.yml`, fork/publish semantics, or prior design decisions.
- `docs/work/diffable-domain.md`: when touching `loom diff`, branch-driven pattern exploration, or projected darts.
- `docs/design-history.md`: when you need why the current design exists — the Loomit / Seamlint / Truer responsibility boundary, seam as a set of participating edges, assembly as a tree, or band seams.
- `docs/core-concepts.md` and `docs/glossary.md`: when you need the current seam vocabulary — connector `id` / `type` / `side`, coincident vs contiguous, band seam, notch signatures.
- `docs/work/implementation-guidelines.md`: when confirming package boundaries, implementation conventions, or general coding rules.
- `docs/work/operational-constraints.md`: when touching file writes, copies, path resolution, error classification, concurrency, or `output/`.
- `docs/technology-selection.md`: when the task depends on tooling choices or cross-platform behavior.
- `docs/cli.md`: when adding, removing, renaming, or changing CLI commands, flags, subcommands, output formats, or command responsibilities.

## Current Seam Model

The seam model has moved past the early two-part connector-length framing. Use the current terms; treat older phrasing in tasks and branch docs as historical.

- A seam is a set of participating edges keyed by a shared connector `id` (the rendezvous). More than two parts can join one seam, so "3+ parts = error" is wrong.
- `type` is a classification label; it does not pair edges. `id` pairs them.
- `side` groups a contiguous seam's participants into exactly two units (e.g. bodice side vs sleeve side).
- A band seam is contiguous with one side exactly one piece (band) and the other side many (neighbours); the band edge length must equal the sum of the neighbour edges.
- Loomit declares structure and identity, including `notch_count` (seam-edge) signatures. Seamlint measures geometry — lengths, notch positions, sum matching — from DXF (ASTM). Truer is the formatter.

Canonical definitions live in `docs/glossary.md` and `docs/design-history.md`.

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
