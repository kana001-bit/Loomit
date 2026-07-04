/**
 * Options for choosing which rules a checker runs.
 *
 * `registry` and `rules` are mutually exclusive: pass a fully built registry,
 * or the rules to build a default registry from — but not both. Supplying both
 * would silently ignore `rules`, so the types forbid it.
 */
export type ExclusiveRuleOptions<Registry, Rule> =
  | { readonly registry?: Registry; readonly rules?: never }
  | { readonly registry?: never; readonly rules?: readonly Rule[] };
