# Loomit

[![CI](https://github.com/kana001-bit/Loomit/actions/workflows/ci.yml/badge.svg)](https://github.com/kana001-bit/Loomit/actions/workflows/ci.yml)

A Git-inspired CLI for pattern making — it reads a diff as a sewing decision, not a blob of coordinates.

*日本語版: [`README.ja.md`](README.ja.md)*

## What is Loomit?

Loomit is a local-first CLI that brings a Git-inspired workflow to pattern making. It focuses on managing design iterations, validating compatibility, tracking meaningful changes, and reusing pattern parts, while leaving CAD editing to external tools such as Valentina (a pattern CAD tool).

In sewing, problems often surface too late — parts that do not match once sewn, prototypes redone over small changes, and losing track of what changed and why. Loomit makes prototyping more intentional, explainable, and less wasteful.

The vocabulary is small — a **part** is one pattern piece, a **connector** is a seam where two parts join, and a **dart** is a folded-in tuck that shapes fabric to the body.

_Making clothes? Start with [Vision](docs/vision.md). Building on it? See [Architecture](docs/architecture.md) and [For Developers](#for-developers) below._

## What a change looks like

A pattern part is plain text, so it lives in an ordinary Git repository. Where `git diff` shows you which lines moved, `loom diff` reads the same two revisions and tells you what the change *does to the garment* — so a commit is a sewing decision ("take in the waist dart"), not a blob of coordinates.

The change below takes in a waist dart. You can read `volume change: reduced` and `connection risk: none` (the part still sews to its neighbours) — after `pnpm install && pnpm build`:

```console
$ node packages/cli/dist/main.js diff examples/waist-dart/bodice-v1.part.loom examples/waist-dart/bodice-v2.part.loom
Loomit diff: changed
From: bodice-front@fitted (body)
To:   bodice-front@fitted (body)

Summary:
  silhouette impact: medium
  volume change:     reduced
  connection risk:   none
  prototype notes:   none

Recheck Hints:
  part role: body
  connectors: none
  requirements: none

Changes:
  [modified] dart waist_front
    - width_mm: 30 -> 35
    - intake_length_mm: 110 -> 120
```

`connection risk: none` means the parts still sew together after the change. The same reading works across Git history (`loom diff main..HEAD --part body`). It is one slice of a larger goal — version control for pattern making — but it runs today, from a fresh clone, with no Valentina or `.val`.

## The three tools

Loomit is one third of a pattern-making toolchain, each with a single job:

| Tool                                                    | Job                                                     |
| ------------------------------------------------------- | ------------------------------------------------------- |
| **Loomit** (this repo)                                  | Pattern structure, the assembly graph, semantic `diff`. |
| **[Seamlint](https://github.com/kana001-bit/Seamlint)** | Measures geometry and reports problems.                 |
| **[Truer](https://github.com/kana001-bit/Truer)**       | Proposes corrections and writes the accepted ones.      |

The boundary is fixed before the internals: Loomit decides *what is joined to what*, Seamlint decides *what is wrong*, Truer decides *how it could be fixed and writes it* — and a human decides *what actually changes*. Loomit never computes geometry and never rewrites a pattern; it issues measurement requests to Seamlint and correction requests to Truer, and reads their answers back. The two hand-off points are `loom slnt check` and `loom match` ([CLI reference](docs/cli.md)).

## Status

Early, local-first, and honest about scope:

- **Built today** — compatibility `check`, semantic `diff` (including across Git revisions, e.g. `loom diff main..HEAD --part body`), fit / movement-test diagnostics, and whole-project reuse (`fork`).
- **Delegated to Git, by design** — snapshots, branches, and history. Loomit's source of truth is plain text (`loomit.yml`, `part.loom`), so a project lives naturally inside a Git repo. `loom diff` reads any two revisions as sewing-level design changes instead of reimplementing version control.
- **On the roadmap** — more `fit` rules, richer diff explanations, and Loomit Studio (UI).

## Example

Before cutting any fabric, check that a garment's parts still sew together. The bundled `examples/blouse` has a body and a sleeve whose armholes match:

```console
$ node packages/cli/dist/main.js check examples/blouse
Loomit check: ok

Compatibility:
  [ok] connector-length body.armhole -> sleeve.armhole
  [ok] requirement-range body.requires.sleeve.armhole.length_mm -> sleeve.armhole.length_mm
  [ok] requirement-range sleeve.requires.body.armhole.length_mm -> body.armhole.length_mm
```

Bump the sleeve's `length_mm` to 481 and re-run: two independent checks catch it, each explained instead of a bare red mark — `CONNECTOR_LENGTH_MISMATCH` (body.armhole and sleeve.armhole differ by 12mm, tolerance 3mm) and `REQUIREMENT_RANGE_UNSATISFIED` (sleeve.armhole.length_mm is 481, expected 466–472).

Diagnostics are structured data — bilingual (Japanese / English) for humans, and `--format json` with a non-zero exit code for CI. `loom doctor` explains the same findings in full sentences. Every check also states what it does *not* guarantee; see [Core Concepts](docs/core-concepts.md).

## For Developers

Loomit is a pnpm monorepo. `@loomit/core` holds the domain logic — schema validation, compatibility / fit / movement rules, semantic diff, and structured reports — with no dependency on the CLI. `@loomit/cli` is a thin adapter that turns core's diagnostics into text or JSON. It is written in TypeScript with Zod schemas and Vitest tests. See [Architecture](docs/architecture.md) for the boundaries and [Core Concepts](docs/core-concepts.md) for the domain model.

## How This Was Built

Loomit is built with AI coding agents, directed by me. The design, architecture, domain modeling, and every judgment call are mine; the agents write the code under rules I set. Those rules live in [`AGENTS.md`](AGENTS.md) — my engineering conventions, written down so the agents follow them (for example: `core` never depends on the CLI; `variant` is not compared as a version; `length_mm` always means the finished measurement). The reasoning behind the design — including decisions I later reversed, and why — is recorded in [Design History](docs/design-history.md).

## Quick Start

Requirements: Node.js 24+ and `pnpm`.

```bash
pnpm install
pnpm build
pnpm test
```

Then try it on a bundled example — no Valentina or `.val` required (`pnpm loom` is a shortcut for `node packages/cli/dist/main.js`):

```console
$ node packages/cli/dist/main.js diff examples/waist-dart/bodice-v1.part.loom examples/waist-dart/bodice-v2.part.loom
```

Command usage and worked examples are in the [Tutorials](docs/tutorials.md).

### Bring your own pattern

The example above is plain text, so `check` and `diff` need no external tools. Working from a real Valentina pattern means giving a part a `.val` source and its exported geometry — a more involved path that is still being documented. See [Core Concepts](docs/core-concepts.md) for how a part references its source.

## Documentation

> Most of these docs are currently written in Japanese; so far only [Core Concepts](docs/core-concepts.md) has an English version.

New here? The shortest path is [Core Concepts](docs/core-concepts.md) for the domain model, then [Tutorials](docs/tutorials.md) to run it. To see how the design decisions were made — and which ones I reversed — read [Design History](docs/design-history.md).

### Getting Started

- [Tutorials](docs/tutorials.md) — Worked examples: validate a project, diff two revisions
- [CLI Reference](docs/cli.md) — Command dictionary for the `loom` CLI
- [Core Concepts](docs/core-concepts.md) — The domain model: parts, connectors, requirements, prototype notes

### Design

- [Why Loomit Exists](docs/why.md) — Why the project started and what kind of problem it comes from
- [Vision](docs/vision.md) — Where Loomit is headed
- [Architecture](docs/architecture.md) — Core / CLI / Studio boundaries, data model, and tool boundaries
- [Design History](docs/design-history.md) — How the design evolved and why major decisions changed
- [Technology Selection](docs/technology-selection.md) — Tooling and library choices for the monorepo

### Development

- [Development](docs/development.md) — How this project is built and the standards it follows

## License

[MIT](LICENSE) © 2026 kana001-bit
