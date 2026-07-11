# Loomit

[![CI](https://github.com/kana001-bit/Loomit/actions/workflows/ci.yml/badge.svg)](https://github.com/kana001-bit/Loomit/actions/workflows/ci.yml)

Git-inspired workflow for iterative pattern making.

*日本語版: [`README.ja.md`](README.ja.md)*

## What is Loomit?

Loomit is a local-first CLI that brings a Git-inspired workflow to pattern making. It focuses on managing design iterations, validating compatibility, tracking meaningful changes, and reusing pattern parts, while leaving CAD editing to external tools such as Valentina.

## Status

Early, local-first, and honest about scope:

- **Built today** — compatibility `check`, semantic `diff`, fit / movement-test diagnostics, and part reuse (`fork`, `publish`, `library`).
- **Delegated to Git, by design** — snapshots, branches, and history. Loomit's source of truth is plain text (`loomit.yml`, `part.loom`), so a project lives naturally inside a Git repo. Loomit adds a sewing-aware layer on top instead of reimplementing version control.
- **On the roadmap** — a closer `loom diff` ↔ Git-revision integration, more `fit` rules, and Loomit Studio (UI).

## Motivation

In sewing, problems often surface too late — parts that do not match once sewn, prototypes redone over small changes, and losing track of what changed and why. Loomit makes prototyping more intentional, explainable, and less wasteful.

## Example

Check that a garment's parts still sew together — before cutting any fabric:

```console
$ loom check my-blouse
Loomit check: ok

Compatibility:
  [ok] connector-length body.armhole -> sleeve.armhole
  [ok] requirement-range body.requires.sleeve.armhole.length_mm -> sleeve.armhole.length_mm
  [ok] requirement-range sleeve.requires.body.armhole.length_mm -> body.armhole.length_mm
```

When a seam no longer matches, the mismatch is caught with an explanation, not just a red mark:

```console
$ loom check my-blouse            # exit code 1
Loomit check: error

Compatibility:
  [error] connector-length body.armhole -> sleeve.armhole
  [error] CONNECTOR_LENGTH_MISMATCH sleeve.armhole
    コネクタの仕上がり線の長さが許容差を超えています。/ Connector finished seam lengths exceed the tolerance.
    suggestion: body.armhole and sleeve.armhole differ by 11mm; allowed tolerance is 3mm.
  …
```

Diagnostics are structured data — bilingual (Japanese / English) for humans, and available as `--format json` with a non-zero exit code for CI. `loom doctor` explains the same findings in full sentences. Every check also states what it does *not* guarantee; see [Core Concepts](docs/core-concepts.md).

## For People Who Make Clothes

→ [`docs/vision.md`](docs/vision.md)

## For Developers

Loomit is a pnpm monorepo. `@loomit/core` holds the domain logic — schema validation, compatibility / fit / movement rules, semantic diff, and structured reports — with no dependency on the CLI. `@loomit/cli` is a thin adapter that turns core's diagnostics into text or JSON. It is written in TypeScript with Zod schemas and Vitest tests. See [Architecture](docs/architecture.md) for the boundaries and [Core Concepts](docs/core-concepts.md) for the domain model.

## Quick Start

Requirements: Node.js 24+ and `pnpm`.

```bash
pnpm install
pnpm build
pnpm test
```

Command usage and worked examples are in the [Tutorials](docs/tutorials.md).

## Documentation

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
