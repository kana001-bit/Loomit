/**
 * checker がどのルールを走らせるかを選ぶためのオプション。
 *
 * `registry` と `rules` は排他。組み立て済みの registry を渡すか、
 * デフォルト registry を組むための rules を渡すかのどちらか一方で、両方は不可。
 * 両方渡すと `rules` が黙って無視されてしまうので、型レベルで禁じている。
 */
export type ExclusiveRuleOptions<Registry, Rule> =
  | { readonly registry?: Registry; readonly rules?: never }
  | { readonly registry?: never; readonly rules?: readonly Rule[] };
