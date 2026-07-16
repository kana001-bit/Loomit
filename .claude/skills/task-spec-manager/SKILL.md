---
name: task-spec-manager
description: "Persist the spec, research, and handoff for a long task that spans multiple sessions or branches into `docs/work/task-specs/<slug>/task-spec.md` instead of chat history. The point is to separate confirmed facts from open questions, with evidence, so another session or agent can resume. Short single-branch progress notes are branch-worklog; the implementation itself is loomit-implementation (no implementation here)."
---

# Task Spec Manager

Entry point for pinning "what is confirmed vs still open" for a long task, outside chat. A new session reads the relevant spec before scrolling long history. This skill is a thin router; read the reference only when you need the writing details.

## When to use / not

- Use: to persist a task spec that spans several sessions or branches, split into confirmed vs open, with evidence.
- Do not use: short single-branch plan / progress / handoff → `branch-worklog` (`docs/work/branch/`). The implementation itself or Loomit invariants → `loomit-implementation`.

## Read first

- The separation rules, evidence format, section layout, and anti-patterns: `references/update-rules.md`.
- Seed a new spec from `docs/work/task-specs/task-spec-template.md`.
- If `docs/work/task-specs/<slug>/task-spec.md` already exists, read it first and append without breaking history.

## Steps

1. Pick a task slug; create `docs/work/task-specs/<slug>/task-spec.md` from the template if missing. Otherwise trust the existing spec before scrolling chat.
2. Sort what you learn into Confirmed spec / Open questions / Existing-implementation findings. Only confirmed facts go in the confirmed section; leave guesses in open questions.
3. Attach evidence to each confirmed statement (file path / function or type name / `Diagnostic.code` / command output / answer date).
4. For confirmed facts that touch Loomit invariants (variant is not a version, `length_mm` is a finished dimension, core stays pure, report fields are a contract), check against `../loomit-implementation/references/` and drop conflicts into open questions for a human.
5. End by updating "Next step" at a granularity another session can resume from.

## Do not

- Mix confirmed and open items. Do not write unsupported assertions in the confirmed section.
- Duplicate implementation rules / invariants here (canonical is `loomit-implementation`).
- Delete a spec after completion. Keep it as history.
