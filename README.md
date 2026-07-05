# Loomit

[![CI](https://github.com/kana001-bit/Loomit/actions/workflows/ci.yml/badge.svg)](https://github.com/kana001-bit/Loomit/actions/workflows/ci.yml)

Git-inspired workflow for iterative pattern making.

*Japanese version: [`README.ja.md`](README.ja.md)*

## What is Loomit?

Loomit is a local-first CLI that brings a Git-inspired workflow to pattern making. It focuses on managing design iterations, validating compatibility, tracking meaningful changes, and reusing pattern parts, while leaving CAD editing to external tools such as Valentina.

## Motivation

In sewing, problems often surface too late — parts that do not match once sewn, prototypes redone over small changes, and losing track of what changed and why. Loomit makes prototyping more intentional, explainable, and less wasteful.

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
