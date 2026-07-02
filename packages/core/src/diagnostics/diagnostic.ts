export const diagnosticSeverities = ["info", "warning", "error"] as const;

export type DiagnosticSeverity = (typeof diagnosticSeverities)[number];

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly target?: string;
  readonly suggestion?: readonly string[];
}

export function createDiagnostic(input: Diagnostic): Diagnostic {
  return input;
}
