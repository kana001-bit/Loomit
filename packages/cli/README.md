# @loomit/cli

A Git-inspired CLI for pattern making — it reads a diff as a sewing decision, not a blob of coordinates.

This package provides the `loom` command. It is a thin adapter that formats the diagnostics produced by [`@loomit/core`](https://www.npmjs.com/package/@loomit/core) as text or JSON.

## Install

```console
npm install -g @loomit/cli
loom --help
```

Loomit measures structure. To also measure geometry and propose corrections, install its companions:

```console
npm install -g seamlint @kana001-bit/truer
```

`loom` finds `slnt` and `tru` on your `PATH`, so no configuration is needed once they are installed.

## What a change looks like

```console
$ loom diff examples/waist-dart/bodice-v1.part.loom examples/waist-dart/bodice-v2.part.loom
Loomit diff: changed
From: bodice-front@fitted (body)
To:   bodice-front@fitted (body)
```

Where `git diff` shows which lines moved, `loom diff` reads the same two revisions and tells you what the change does to the garment.

## Documentation

Full documentation, examples, and design history live in the repository:
https://github.com/kana001-bit/Loomit

## License

MIT
