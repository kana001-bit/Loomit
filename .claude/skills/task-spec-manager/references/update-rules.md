# Task Spec Update Rules

Details for writing / updating `docs/work/task-specs/<slug>/task-spec.md`. The template is
`docs/work/task-specs/task-spec-template.md`.

## Confirmed vs open

A spec exists so a later reader can tell what is safe to believe. Always separate the two.

- **Confirmed spec**: verified facts only, each with evidence.
- **Open questions**: undecided, waiting-on-answer, or assumed. Anything here is marked "do not trust yet".
- When in doubt, put it in open. Do not promote a guess to confirmed without evidence.

## Evidence

Attach at least one to every confirmed fact or finding:

- A real file path (e.g. `packages/core/src/seamlint/geometryReport.ts`).
- A function / type / schema / `Diagnostic.code` name (e.g. `describeFsError()` / `CONNECTOR_LENGTH_MISMATCH`).
- A runnable command and its output (e.g. `pnpm --filter core test`, `loom check <project>`).
- For a human answer: the date and what was answered (e.g. 2026-07-14 answer: variant is a design lineage, not a version).

## Sections

- **Purpose / Background**: why the task exists, in 1–3 lines.
- **Confirmed spec**: follows the separation rule above.
- **Open questions**: questions / assumptions / waiting items. Move to confirmed with evidence once resolved.
- **Stakeholder status**: unconfirmed / waiting / answered / needs recheck / done / implementation-deferred.
- **Existing-implementation findings**: current behavior, and a change / keep decision. For parts touching Loomit invariants (variant, `requires`, `length_mm`, core purity, report contract), check against `../loomit-implementation/references/`.
- **Plan / changed files**: concretize only when a plan is confirmed.
- **Test angle**: what spec the change protects and what breaks if it fails.
- **Work log**: dated (`YYYY-MM-DD`) append-only entries.
- **Next step**: at a granularity another session can resume from.

## Avoid

- Mixing confirmed and open items in one list.
- Unsupported assertions in the confirmed section.
- Duplicating Loomit implementation rules / invariants here (canonical is `loomit-implementation`; reference, do not copy).
- Deleting a spec after completion. Keep it as history.

## Boundary with branch-worklog

- Single-branch plan / progress / handoff → `docs/work/branch/<branch>.md` (`branch-worklog`).
- A long-lived, cross-branch confirmed spec → task spec.
- Do not mechanically copy one into the other. The long-lived confirmed spec is the task spec.
