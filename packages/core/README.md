# loomit-core

The domain layer of [Loomit](https://github.com/kana001-bit/Loomit), a Git-inspired toolchain for pattern making.

This package holds schema validation, compatibility / fit / movement rules, semantic diff, and the structured report shape. It has no dependency on the CLI, so it can be embedded in other tools.

Looking for the `loom` command? Install [`loomit`](https://www.npmjs.com/package/loomit) instead.

## Install

```console
npm install loomit-core
```

## Contracts

The JSON Schema for the constraint payload handed off to [truer](https://www.npmjs.com/package/@kana001-bit/truer) ships with this package at `schema/constraint-payload.v0.json`, so downstream tools can validate against it without cloning the repository.

## Documentation

https://github.com/kana001-bit/Loomit

## License

MIT
