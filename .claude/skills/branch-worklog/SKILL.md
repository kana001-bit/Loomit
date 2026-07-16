---
name: branch-worklog
description: Maintain branch-scoped worklog markdown files under docs/work/branch for cross-session planning and progress tracking. Use when Codex needs to create, bootstrap, or update the plan/status log for the current git branch; when work needs to survive handoff across sessions or agents; or when a branch needs a compact summary of goals, next steps, blockers, and validation history.
---

# Branch Worklog

Use this skill to keep a durable, branch-local record that another session can resume without rereading the whole conversation.

## Workflow

1. Run `node ./.claude/skills/branch-worklog/scripts/ensure_branch_note.mjs` from the repository root. It resolves the current branch, creates the note under `docs/work/branch/` if missing, and prints the resolved path.
2. Slash-separated branch names become nested folders (e.g. `feature/diff-decision-summary` -> `docs/work/branch/feature/diff-decision-summary.md`).
3. If the worklog is new and a matching task doc exists, seed it from the durable parts:
   - Prefer `docs/work/tasks/<branch-with-slashes-replaced-by-hyphens>.md` when it exists.
   - Otherwise use the active user request and the directly related project docs.
4. Update the worklog at the start of substantial work and again when the plan or status changes.
5. Preserve history. Edit summary sections in place, but append dated entries in `## Progress` instead of rewriting old notes.

## Required Format

Use the template in `references/worklog-format.md`. Keep these sections:

- `## Goal`: one short paragraph (say so if inferred)
- `## Plan`: short checklist of remaining work
- `## Progress`: dated bullets
- `## Open Questions`: only unresolved items
- `## Validation`: checks run or skipped, with reason
- `## Next Handoff`: one concrete resume point

## Updating Rules

- Keep `## Plan` future-facing. Move finished items into `## Progress`.
- Use exact dates, not relative words like "today" or "yesterday".
- Mention validation status in progress entries, even when checks were not run.
- Record decisions that would be expensive to rediscover: target files, test commands, blockers, and explicit deferrals.
- Keep the file compact enough that a new agent can scan it in under a minute.

## Task Seeding

- If a matching task doc exists, copy only the durable parts: goal, scope, done criteria, and known follow-up branches.
- Do not duplicate large docs verbatim; summarize them into branch-specific action items.

## Handoff Standard

- Assume the next reader has no access to prior chat context.
- Prefer concrete statements over vague summaries.
- When work is complete, set `## Next Handoff` to `None.` and leave a final dated `## Progress` entry summarizing code changes, tests, and docs touched.
