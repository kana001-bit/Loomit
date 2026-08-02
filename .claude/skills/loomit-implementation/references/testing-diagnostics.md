# Loomit Testing and Diagnostics Rules

Use these rules when adding tests, diagnostics, reports, or CLI output for Loomit.

## Test Comments

Every test must include a comment stating the protected specification.

```ts
it("reports length mismatch", () => {
  // 守る仕様: 仕上がり線の長さが tolerance を超えてずれた connector は error になる。
});
```

For either/or behavior, test both meanings and comment each one.

```ts
it("reports unmeasured connectors instead of comparing length", () => {
  // 守る仕様: length_mm 未指定の connector は connector-length 比較にかけず、CONNECTOR_LENGTH_UNMEASURED を出す。
});

it("compares length when both sides are measured", () => {
  // 守る仕様: 両側が length_mm を持つ connector は connector-length 比較の対象になり、許容差超過で CONNECTOR_LENGTH_MISMATCH になる。
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
CONNECTOR_MISSING
PROJECT_SCHEMA_INVALID
```

### Code registry

Every code **Loomit itself emits** lives in `packages/core/src/diagnostics/codes.ts`, and
`Diagnostic.code` is the union derived from it — not `string`. **A new Loomit diagnostic will not
compile until its code is registered there.** Add it to the group matching the producing module.

Two registered groups exist. `coreDiagnosticCodes` is what core emits. `cliDiagnosticCodes` is what
the CLI layer emits for concerns core cannot structurally have (spawning `slnt` / `tru`, resolving
paths handed in as CLI arguments). Both live in core because `--format json` consumers see one
vocabulary; core does not depend on the CLI, only the names sit together.

The union is what links a code to the code that reads it. `doctorReport.ts` matches codes by
equality to attach explanations, so renaming a code in its producing module makes that comparison a
`TS2367` error instead of a silent loss of the explanation.

Codes are a stable contract: treat a rename as a breaking change for anyone branching on the JSON
report, and do not rename purely for spelling taste.

The registry is **not** every code that can appear in report JSON. Two kinds pass through unregistered:

- **Seamlint-origin diagnostics.** `SeamlintGeometryDiagnostic.code` is `string` and stays Seamlint's
  vocabulary; `loom slnt check --format json` emits it verbatim. Loomit does not pin another tool's codes.
- **Codes from injected rules.** Rule injection (`runFit(project, profile, { rules })` and the
  exported `FitRule` / `MovementTestRule` / `CompatibilityRule`) is a public extension point, so a
  caller's rule can emit `CustomDiagnosticCode` — any code prefixed `X_`. (`TestSuggestionRule` is
  not in that list: `TestSuggestion` has no `diagnostics`, so suggestion rules emit no codes.)
  The prefix keeps the guard working (a typo of a known code does not start with `X_`, so it still
  fails to compile) and lets a report reader tell Loomit's vocabulary from a caller's.

Loomit itself must never emit an `X_` code. That is enforced two ways: `createDiagnostic` takes
`RegisteredDiagnostic`, so every Loomit emission site is typed to registered codes only; and a test
scans `packages/*/src` for `code: "X_…"` literals to catch a hand-built `Diagnostic` that bypasses
the helper.

`Diagnostic.message` is user-facing. In early v0, write Japanese and English together while the wording is still being learned through real use. Put Japanese first, then English, so the message remains comfortable for the primary user and readable for future OSS users.

```ts
{
  code: "CONNECTOR_LENGTH_MISMATCH",
  message:
    "袖ぐりの仕上がり線の長さが許容差を超えています。 / The finished armhole seam length exceeds the tolerance."
}
```

Keep `Diagnostic.code` stable and English. Do not encode localization differences in `code`.

### Messages that carry a detail

The bilingual rule applies to `Diagnostic.message` — the finished sentence a user reads. A field named
`message` is not automatically one: `SeamlintRunResult.message` and `TruerRunResult.message` are failure
details that a diagnostic builder interpolates. Before adding Japanese to something called `message`,
check whether it is emitted as a diagnostic or interpolated into one.

Two rules apply when a message carries a detail (an errno string, a tool's stderr, an external failure):

**The detail stays English.** Making it bilingual nests one `日本語 / English` pair inside another, so the
same sentence arrives two or three times over.

**The detail goes once, after the bilingual sentence closes** — not inside each half. Close the Japanese
sentence, close the English sentence, then append the detail in parentheses.

```ts
// Good: one separator, and the Japanese/English boundary stays at the front where it is readable.
message: `Seamlint を実行できませんでした。 / Loomit could not run Seamlint. (${runResult.message})`;

// Avoid: the detail lands in both halves. A short detail merely repeats; a long one (Seamlint's stderr
// can carry a whole traceback) buries the " / " mid-paragraph, so the boundary is no longer findable.
message: `Seamlint を実行できませんでした: ${runResult.message} / Loomit could not run Seamlint: ${runResult.message}`;
```

The second rule is pinned by `never interpolates the same detail into both halves of a bilingual message`
in `packages/core/test/diagnostics/diagnostic-codes.test.ts`. It scans line by line, so a template split
across lines slips past it — review still matters.

`Diagnostic.target` should use a stable reference. Current formats:

```text
{role}.{connector-id}              # connector existence / length
{connector-id}.{side}              # side / over-pair checks on a join
{role}.requires.{path}             # requirement range checks
{role}.{connector-id}.{property}   # resolved requirement target
```

A connector id is the shared rendezvous key, so one seam can join more than two parts under a single id (see `docs/glossary.md`). If another target format is needed, document it before introducing it.

## Report Compatibility

`Diagnostic`, `CheckReport`, `FitReport`, and other report structures are shared by CLI and future Studio.

- Treat report field renames as breaking changes.
- Do not reshape core reports only for CLI display convenience.
- Keep display-only wording changes in formatters.
- If removing a report field, record why in code comments or docs.

## Slice Completion

Before finishing work:

- Confirm the active `docs/work/implementation-plan.md` slice.
- Confirm the slice's completion criteria.
- Run the relevant unit or fixture tests.
- Run `pnpm typecheck` and `pnpm test` when available.
- If checks cannot run, state why.
