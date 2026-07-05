---
name: branch-worklog
description: Maintain branch-scoped worklog markdown files under docs/branch for cross-session planning and progress tracking. Use when Codex needs to create, bootstrap, or update the plan/status log for the current git branch; when work needs to survive handoff across sessions or agents; or when a branch needs a compact summary of goals, next steps, blockers, and validation history.
---

# Branch Worklog

Use this skill to keep a durable, branch-local record that another session can resume without rereading the whole conversation.

## Workflow

1. Read the current branch with `git branch --show-current`.
2. Map that branch to `docs/branch/<branch>.md`.
3. Keep `/` from the branch name as directories, so `feature/diff-decision-summary` becomes `docs/branch/feature/diff-decision-summary.md`.
4. Create any missing parent directories before writing the file.
5. If the worklog does not exist yet, seed it from the most relevant existing docs:
   - Prefer `docs/tasks/<branch-with-slashes-replaced-by-hyphens>.md` when it exists.
   - Otherwise use the active user request and the directly related project docs.
6. Update the worklog at the start of substantial work and again when the plan or status changes.
7. Preserve history. Edit summary sections in place, but append dated entries in `## Progress Log` instead of rewriting old notes.

## Required Format

Use the template in `references/worklog-format.md`.

Keep these sections:

- Title: full branch name
- `Status:` `planned | in progress | blocked | done`
- `Updated:` exact date in `YYYY-MM-DD`
- `## Goal`: one short paragraph
- `## Plan`: short numbered list of remaining work
- `## Progress Log`: dated bullets, newest first
- `## Risks / Questions`: only unresolved items
- `## Next Step`: one concrete next action
- `## References`: relevant docs, tests, branches, or files

## Updating Rules

- Keep `## Plan` future-facing. Move finished items into `## Progress Log`.
- Use exact dates, not relative words like "today" or "yesterday".
- Mention validation status in progress entries, even when checks were not run.
- Record decisions that would be expensive to rediscover: target files, test commands, blockers, and explicit deferrals.
- Keep the file compact enough that a new agent can scan it in under a minute.

## Task Seeding

- If a matching task doc exists, copy only the durable parts: goal, scope, done criteria, and known follow-up branches.
- If a branch is clearly tied to a roadmap slice, add the relevant roadmap doc to `## References`.
- Do not duplicate large docs verbatim; summarize them into branch-specific action items.

## Handoff Standard

- Assume the next reader has no access to prior chat context.
- Prefer concrete statements over vague summaries.
- When work is complete, set `Status: done`, set `## Next Step` to `None.`, and leave a final dated entry summarizing code changes, tests, and docs touched.
