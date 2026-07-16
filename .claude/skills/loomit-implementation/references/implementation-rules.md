# Loomit Implementation Rules

Use these rules when modifying Loomit source code, schemas, package structure, or CLI behavior.

## Implementation Order

Follow `docs/work/implementation-plan.md`. Work by slice. Do not jump ahead to Studio, DB, plugin runtime, CAD engine, physics simulation, or library auto-update.

## Core and CLI Boundaries

- `core` must not depend on CLI or Studio.
- CLI is a thin adapter: parse args, call core, format results, set exit code.
- Do not put domain logic in CLI commands.
- Core returns data such as reports and diagnostics; CLI owns text output and process exit.
- If a change adds, removes, renames, or materially changes a CLI command, flag, subcommand, output format, or command responsibility, update `docs/cli.md` in the same change.

## Core Side Effects

Core modules must not call:

```ts
console.log(report);
process.exit(1);
process.stdout.write(text);
process.stderr.write(text);
```

Pure rule logic must not read the current time, generate random values, or access the filesystem inside the rule. Inject deterministic values or preloaded data from the caller.

```ts
// Good: deterministic input is injected.
createPublishedMeta(part, { publishedAt });
```

## File I/O vs Domain Logic

Keep file I/O separate from pure domain checks.

```text
loadProjectFile() -> parse/validate
resolveParts() -> assemble domain object
runCompatibilityRules() -> pure rule evaluation
```

Compatibility rules, fit rules, and movement test rules should receive domain objects, not file paths.

## File I/O Safety (Operational)

The filesystem is the source of truth. Server-side concerns (transactions, locking, injection, monitoring) do not disappear here — they take a file-shaped form. See `docs/work/operational-constraints.md` for the full rationale and the code sites each rule addresses. When touching writes, copies, path resolution, or I/O error handling, follow these rules.

### R1. Writes to durable state must be atomic

The filesystem has no transaction. A `mkdir -> cp -> writeFile` sequence that fails partway (error, disk full, Ctrl-C) leaves a half-written state that nothing rolls back.

- Write source-of-truth files (`loomit.yml`, `part.loom`, `meta.yml`, `prototype-notes.yml`, `manifest.json`) through a shared helper that writes to a temp file and `rename`s it (same-volume rename is atomic).
- Do not call `writeFile` directly inside commands or domain operations.
- Operations that mutate multiple files/directories must define a failure cleanup order, or stage next to the target and `rename` last.

```ts
// Good: single write goes through the atomic helper.
await writeFileAtomic(projectFilePath, stringify(project));

// Avoid: direct writeFile leaves partial state if a later step fails.
await writeFile(projectFilePath, stringify(project), "utf8");
```

### R2. Resolved paths must stay inside an allowed root

Paths derived from file contents (`parts.*`, `outputs.dir`) or CLI arguments (`--name`, `--library`) can escape the project/library root via `..` or an absolute path. `resolve()` alone does not prevent this. Forked, published, and library-imported files come from other people, so these paths are not fully trusted.

- After `resolve()`, verify the path is contained in its allowed root before any I/O (`relative(root, p)` must not start with `..` and must not be absolute). The existing `isSameOrChildPath` check can be generalized into a reusable containment guard.
- Constrain identifiers used as path segments (`name`, `role`, `type`, `localName`, `outputs.dir`) in the schema to segment-safe characters. Reject slashes, `..`, and absolute paths.

### R3. I/O errors must be classified by errno, not swallowed

Permission, disk-full, already-exists, and not-found each require a different user action. Loomit's value is explainable diagnostics, so collapsing them into one message contradicts the product.

- Do not use `catch {}` with no binding on I/O.
- Inspect the caught error's errno (`EACCES`, `ENOSPC`, `EEXIST`, `EROFS`, `ENOENT`) and emit distinct diagnostic `code`s / messages for at least: permission, out of space, already exists, not found.

### R4. Copy scope must be explicit

`cp(recursive)` copies the whole tree, including generated artifacts and large binaries.

- Any recursive copy must limit its scope with an explicit policy.
- Generated output (`output/`) is not a source of truth and must not be included in `fork` or `publish`.

### R5. Concurrent writers are assumed to be single

Source-of-truth files have no lock; every existence guard is check-then-use (TOCTOU). A single-user CLI is usually fine, but Studio (long-lived), watch mode, and parallel CI break this.

- v0 assumes at most one writer per project at a time. State this assumption explicitly; do not leave it implicit.
- Introduce a project-level advisory lock before shipping any feature that breaks single-writer (Studio live editing, watch, parallelism).

### R6. `output/` is a regenerable directory

Build overwrites `output/` and does not remove stale files, so the manifest can drift from what is on disk.

- Treat `output/` as a Loomit-managed regenerable area. Build overwrites/cleans only known outputs and keeps the manifest consistent with the files present.
- Preservation of user-placed files under `output/` is not guaranteed; make this a documented convention.

## Type Safety

Do not use the `any` type. For genuinely-unknown values use `unknown` and narrow at the use site.

`unknown` needs no comment at untrusted-input boundaries and in caught errors — the existing patterns: `catch (error: unknown)`, type predicates (`isRecord(value: unknown): value is Record<string, unknown>`), schema/report validation (`validateSchema(input: unknown)`, `parseYamlText`), and `expected?`/`actual?: unknown` contract fields. Other intentional `unknown`, and explicit `undefined` type annotations, get a one-line reason.

```ts
// boundary: external YAML input, validated immediately below
const parsed: unknown = parseYaml(source);
```

Avoid gratuitous widening:

```ts
const value: any = input;      // banned outright
const value: unknown = input;  // unknown with no boundary/validation reason
```

Prefer domain types, schema types, discriminated unions, or optional properties. `src` is currently `any`-free — keep it.

## Design Decision Comments

Add short comments where future agents may incorrectly apply software-version assumptions.

Comment especially near:

- `name` + `variant` separation.
- Avoiding comparisons between variants.
- `requires` as direct measurement/tag/material constraints.
- Manual `status: deprecated` semantics.
- Separation of `prototype-notes.yml` from `loomit.yml`.

Example:

```ts
// Design decision: variant is an identifier, not an ordered software version.
// Sewing parts do not become better just because the variant label is larger.
```

## Stale Comments

A comment is part of the change, not a separate chore. When you modify behavior, schema, a rule, a field name, or a CLI surface, hunt down and fix every comment that described the old behavior — including comments in code you did not otherwise edit but that your change made false.

- A comment that contradicts the current code is worse than no comment: it sends the next agent down a path that no longer exists.
- When reviewing a diff, read each hunk's surrounding comments, not only the changed lines, and repair the ones your change invalidated.
- The same rot spreads to `docs/` lines, `守る仕様:` test comments, and skill examples that pin down old behavior (a removed flag, a renamed field, a retired rule). Delete or correct them in the same change. If an example names a feature, confirm the feature still exists before leaving it.

## Documentation Precedence

If docs and implementation disagree:

1. Treat `docs/vision.md` and `docs/architecture.md` as design intent. Do not casually rewrite them to match code.
2. Treat `docs/work/implementation-guidelines.md`, `docs/work/implementation-plan.md`, and `docs/technology-selection.md` as implementation guidance that can follow confirmed implementation details.
3. If changing design decisions such as `variant`, finished measurements, or prototype-note inheritance, update design docs first.
