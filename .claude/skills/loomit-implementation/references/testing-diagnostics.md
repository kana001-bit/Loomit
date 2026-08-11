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

## Guidance Is Behavior

A diagnostic's `suggestion`, and any prompt text that says "do this instead", names a **destination**:
a command to run, an option to pick, a value to use. Asserting that the text was printed does not check
that the destination exists. Those are two different claims, and only the second one helps the user.

**Follow the guidance in the test, and assert that the diagnostic it was about no longer fires.**

Exit code is too weak an outcome. A command can exit 0 and leave the original problem in place, and a
guidance loop that swaps one suggestion for another can keep failing forever. "Arrived" means the
thing the guidance was about is gone.

```ts
// Good: the printed recovery is executed, and the original refusal is gone afterwards.
const required: RegisteredDiagnosticCode = "CONNECT_SIDE_REQUIRED";
expect(codesOf(before.diagnostics)).toContain(required);

await runCli(["node", "loom", "connect", "lining", "--join", "waist", "--side", "neighbour"], …);
expect(codesOf(await recheck())).not.toContain(required);

// Avoid: only proves the sentence is printed. A destination that always fails passes this.
expect(stdout).toContain("run loom connect …");
```

**When the guidance cannot be executed** — "check file permissions", anything needing an external tool,
a network, or a destructive step — assert that the destination *exists* instead: the command is in the
CLI's registered commands, the option is in the parser's option set, the value is in the set actually
offered. Do not skip the assertion because you cannot run it; an unasserted destination is exactly the
one that rots.

Both halves are the same rule as the implementation one: **branch on the real state, never on a copy of
the rule.** `formatJoinIdClash` takes the set of ids actually offered and asks whether this id is in it,
instead of re-deriving why it was excluded. Prose that copied the old conditions goes stale silently
when a new exclusion reason is added; a membership check follows along.

Real failures this rule would have caught (all shipped green):

| Guidance | Reality |
|---|---|
| `loom connect … --as <existing id>` | always fails with `CONNECT_ID_ALREADY_DECLARED` |
| "Pick it from the list" | the join was excluded from that list |
| "use `--notches 3` to match" | following it answers "use 2", which answers "use 3" |

## Tests That Pass Without Checking Anything

Two shapes recur. Both stay green while testing nothing.

**A negative assertion for a string that never appears anyway.** `not.toContain("X")` passes when the
code can never emit `X` — a typo, or a rename that left the test behind. Do not rely on a one-time
manual check; a ritual leaves nothing behind six months later. **Pin the name through the union so a
rename is a compile error**, the same trick `doctorReport.ts` uses to make `TS2367` catch a lost
explanation:

```ts
// Renaming or misspelling the code fails to compile (TS2820), instead of silently passing.
const missing: RegisteredDiagnosticCode = "CONNECTOR_MISSING";
expect(codesOf(report.diagnostics)).not.toContain(missing);

// Avoid: a bare string. After a rename this asserts the absence of a code that no longer exists.
expect(stdout).not.toContain("CONNECTOR_MISSING");
```

The union only covers codes. When the negative assertion is about wording or a format that has no
union, reproduce the broken state once, look at the real output, and record in the test comment what
you saw — so the next reader knows the assertion was not vacuous when it was written.

**A batch loop where one branch swallows the rest.** Running several inputs through one function and
asserting a property of each is only as good as the branches actually reached. If an earlier guard
catches every input, the loop proves one branch.

```ts
// Pin which paths were exercised, not just the property. This caught a fixture where a
// three-sided seam made every input fail the health check before reaching the side guards.
// Sorted on both sides: which paths ran is the point, their order is not a contract.
expect(refusals.flatMap((r) => codesOf(r.diagnostics)).sort()).toEqual(
  ["CONNECT_SIDE_REQUIRED", "CONNECT_SIDE_UNKNOWN", …].sort()
);
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
across lines slips past it.

That gap is a property of scanning source text, not something review can be trusted to close — the same
nesting was shipped twice, once in `fsError.ts` and again in `connectParts.ts` right after fixing it. The
scan cannot see a bilingual string that arrives through a variable at all. Making the bad shape
unrepresentable is what would actually close it: a builder that takes the Japanese sentence, the English
sentence, and the detail as **separate arguments** cannot interpolate the detail into both halves, the
same way `createDiagnostic` taking `RegisteredDiagnostic` closes the code vocabulary. Not built yet; until
then a runtime check on the finished message is the cheaper guard — count the `" / "` separators over a
function's whole refusal surface at once, rather than per message (`extend-join.test.ts` does this).

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
- Run `pnpm typecheck` **and** `pnpm test`. Both exist; run them separately. vitest does not typecheck,
  so a green `pnpm test` regularly sits on top of a failing `pnpm typecheck`.
- If checks cannot run, state why.
