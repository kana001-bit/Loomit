import type { Diagnostic } from "../diagnostics/diagnostic.js";

export type LoadFileResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly Diagnostic[];
    };
