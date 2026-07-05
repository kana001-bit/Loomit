# Branch Worklog Format

Use this format for `docs/branch/<branch>.md`.

## Path rule

- Preserve the branch path structure under `docs/branch/`.
- Example: `feature/diff-decision-summary` -> `docs/branch/feature/diff-decision-summary.md`
- When seeding from task docs, look for `docs/tasks/feature-diff-decision-summary.md`.

## Template

```md
# feature/example-branch

Status: in progress
Updated: 2026-07-05

## Goal

Summarize the branch outcome in 1-3 sentences.

## Plan

1. Describe the next implementation step.
2. Describe the next validation or integration step.
3. Describe the finish line for this branch.

## Progress Log

- 2026-07-05: Bootstrapped the branch worklog from the task doc. Checks: not run.

## Risks / Questions

- Note the main open question or blocker.

## Next Step

Implement the highest-leverage next action.

## References

- `docs/tasks/example-branch.md`
- `docs/implementation-plan.md`
```

## Writing notes

- Keep `Status` and `Updated` at the top for fast scanning.
- Keep `Plan` focused on what remains.
- Keep `Progress Log` append-only, with newest entries first.
- Mention exact check commands when they matter.
