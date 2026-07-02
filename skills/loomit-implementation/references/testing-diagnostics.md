# Loomit Testing and Diagnostics Rules

Use these rules when adding tests, diagnostics, reports, or CLI output for Loomit.

## Test Comments

Every test must include a comment stating the protected specification.

```ts
it("reports length mismatch", () => {
  // 守る仕様: 仕上がり線の長さが tolerance を超えてずれた connector は error になる。
});
```

For flags or disabled/enabled behavior, test both meanings and comment each one.

```ts
it("skips disabled connector checks", () => {
  // 守る仕様: check: disabled は「この辺を縫わないため互換チェック対象から外す」という意味。
});

it("checks enabled connectors", () => {
  // 守る仕様: check が disabled でない connector は通常の互換チェック対象になる。
});
```

## Fixture Tests

`loom check` reliability depends on fixture tests. Use realistic project-shaped fixtures under `packages/core/test/fixtures/`.

Recommended early fixtures:

```text
valid-blouse/
missing-sleeve/
length-mismatch/
```

When changing compatibility rules or diagnostics, prefer both:

- focused unit tests over domain objects
- fixture tests over project directories

## Diagnostics

`Diagnostic.code` is stable and machine-oriented. Use uppercase snake case.

```text
CONNECTOR_LENGTH_MISMATCH
PART_NOT_FOUND
PROJECT_SCHEMA_INVALID
```

`Diagnostic.message` is user-facing. In early v0, write Japanese and English together while the wording is still being learned through real use. Put Japanese first, then English, so the message remains comfortable for the primary user and readable for future OSS users.

```ts
{
  code: "CONNECTOR_LENGTH_MISMATCH",
  message:
    "袖ぐりの仕上がり線の長さが許容差を超えています。 / The finished armhole seam length exceeds the tolerance."
}
```

Keep `Diagnostic.code` stable and English. Do not encode localization differences in `code`.

`Diagnostic.target` should use a stable reference. For connectors, use:

```text
{part-role}.{connector-name}
```

Examples:

```text
body.armhole
sleeve.armhole
```

If another target format is needed, document it before introducing it.

## Report Compatibility

`Diagnostic`, `CheckReport`, `FitReport`, and other report structures are shared by CLI and future Studio.

- Treat report field renames as breaking changes.
- Do not reshape core reports only for CLI display convenience.
- Keep display-only wording changes in formatters.
- If removing a report field, record why in code comments or docs.

## Slice Completion

Before finishing work:

- Confirm the active `docs/implementation-plan.md` slice.
- Confirm the slice's completion criteria.
- Run the relevant unit or fixture tests.
- Run `pnpm typecheck` and `pnpm test` when available.
- If checks cannot run, state why.
