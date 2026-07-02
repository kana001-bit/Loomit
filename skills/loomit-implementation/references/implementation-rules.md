# Loomit Implementation Rules

Use these rules when modifying Loomit source code, schemas, package structure, or CLI behavior.

## Implementation Order

Follow `docs/implementation-plan.md`. Work by slice. Do not jump ahead to Studio, DB, plugin runtime, CAD engine, physics simulation, or library auto-update.

## Core and CLI Boundaries

- `core` must not depend on CLI or Studio.
- CLI is a thin adapter: parse args, call core, format results, set exit code.
- Do not put domain logic in CLI commands.
- Core returns data such as reports and diagnostics; CLI owns text output and process exit.

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

## Type Safety

`any`, `unknown`, and explicit `undefined` types are not allowed without a local explanatory comment.

```ts
// Intentionally unknown: external YAML input is validated immediately below.
const parsed: unknown = parseYaml(source);
```

Avoid:

```ts
const value: any = input;
const value: unknown = input;
type MaybeName = string | undefined;
```

Prefer domain types, schema types, discriminated unions, or optional properties.

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

## Documentation Precedence

If docs and implementation disagree:

1. Treat `docs/vision.md` and `docs/architecture.md` as design intent. Do not casually rewrite them to match code.
2. Treat `docs/implementation-guidelines.md`, `docs/implementation-plan.md`, and `docs/technology-selection.md` as implementation guidance that can follow confirmed implementation details.
3. If changing design decisions such as `variant`, finished measurements, or prototype-note inheritance, update design docs first.
