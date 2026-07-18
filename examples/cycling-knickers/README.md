# Example: a three-piece garment that assembles

Cycling knickers made of three parts — a `front`, a `back`, and a `waistband` —
joined by three seams. This is the smallest example that exercises Loomit's
assembly graph: a plain seam, and a band seam.

No Valentina, no `.val`, no Git setup: these are plain-text pattern parts.
From the repo root, after `pnpm install && pnpm build`:

```console
$ node packages/cli/dist/main.js check examples/cycling-knickers
Loomit check: ok

Compatibility:
  [ok] connector-length front.outseam -> back.outseam
  [ok] connector-length front.inseam -> back.inseam
  [ok] requirement-range front.requires.back.outseam.length_mm -> back.outseam.length_mm
  [ok] requirement-range front.requires.back.inseam.length_mm -> back.inseam.length_mm
  [ok] requirement-range back.requires.front.outseam.length_mm -> front.outseam.length_mm
  [ok] requirement-range back.requires.front.inseam.length_mm -> front.inseam.length_mm
```

## The three seams

| seam | kind | joins | notch_count |
|---|---|---|---|
| `outseam` | plain seam | front ↔ back | **4** |
| `inseam` | plain seam | front ↔ back | 2 |
| `waist` | band seam | waistband ↔ (front + back) | — |

A **plain seam** sews two edges together, so both parts declare the connector
with the same id (`outseam`, `inseam`) and their lengths must agree within
tolerance — that is what `check` verifies above.

A **band seam** sews one long piece (the waistband, `side: band`) onto the
contiguous edges of several neighbours (front and back, `side: neighbour`). Its
correctness is "does the band length equal the sum of the edges it covers"
(680 mm ≈ 340 + 340), which is a *geometric* fact — Seamlint measures it, so it
does not appear in the structural `check` above.

## Why `outseam` has `notch_count: 4`

`notch_count` is the per-seam **notch signature**: how many notches fall on that
seam edge. Loomit hands this integer to Seamlint so it can tell apart several
seams that share the same two pattern pieces (front and back share *both* the
outseam and the inseam).

The count includes **every passmark type**, not just plain V-notches:

- `outseam` → **4** = 2 V-notches + 2 T-notches.
- `inseam` → 2 = V-notches only.

This matters because Seamlint reads notches from every ASTM layer (V, T, castle,
…) and matches the count exactly. If you counted only the V-notches on the
outseam (`2`), a seam that really has 2 V + 2 T would mismatch and Seamlint would
false-fire `no-notch-match`. The convention — *count all passmark types* — is
documented on `connectors.<id>.notch_count` in the part schema and on
`loom connect --notches` in [docs/cli.md](../../docs/cli.md).

> The split for these knickers (2 V + 2 T on the outseam, 0 T on the inseam and
> waist) is the real measurement taken from `cycling_knickers.val` on
> 2026-07-18, when Seamlint began reading all ASTM notch layers.

The band seam carries no `notch_count`: a band is located by its own contiguous
edge geometry, not by a notch signature, so the field would be dead data there.

## Wiring it to real geometry

`check` validates structure only. To actually *measure* the seams you would
export each part to ASTM DXF, point `connectors.<id>.path_ref` and
`files.geometry` at it, and run `loom slnt check`. Without geometry, a request
build reports every seam as "path_ref missing" and measures nothing — which is
the intended stopping point for this plain-text example.
