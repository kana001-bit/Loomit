# Example: reading a waist-dart change

Two revisions of the same bodice-front part. They differ only in the waist dart —
`bodice-v2` takes it in (`width_mm` 30 → 35, `intake_length_mm` 110 → 120).

No Valentina, no `.val`, and no Git setup needed: these are plain-text pattern parts.
From the repo root, after `pnpm install && pnpm build`:

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

`git diff` would show the same two numbers changing. `loom diff` adds what the change
does to the garment — the volume is reduced, and `connection risk: none` means the
part still sews to its neighbours.
