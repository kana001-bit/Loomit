import { getStatusForDiagnostics } from "../diagnostics/report.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { ReportStatus } from "../diagnostics/report.js";

export interface CompatibilityResult {
  readonly status: ReportStatus;
  readonly from: string;
  readonly to: string;
  readonly rule: string;
  readonly actual?: unknown;
  readonly expected?: unknown;
  readonly diagnostics: readonly Diagnostic[];
}

export interface CheckReport {
  readonly status: ReportStatus;
  readonly diagnostics: readonly Diagnostic[];
  readonly compatibility: readonly CompatibilityResult[];
}

export function createCompatibilityResult(input: {
  readonly from: string;
  readonly to: string;
  readonly rule: string;
  readonly actual?: unknown;
  readonly expected?: unknown;
  readonly diagnostics?: readonly Diagnostic[];
}): CompatibilityResult {
  const diagnostics = input.diagnostics ?? [];

  return {
    status: getStatusForDiagnostics(diagnostics),
    from: input.from,
    to: input.to,
    rule: input.rule,
    actual: input.actual,
    expected: input.expected,
    diagnostics
  };
}

export function createCheckReport(input: {
  readonly diagnostics?: readonly Diagnostic[];
  readonly compatibility?: readonly CompatibilityResult[];
}): CheckReport {
  const diagnostics = input.diagnostics ?? [];
  const compatibility = input.compatibility ?? [];
  const allDiagnostics = [
    ...diagnostics,
    ...compatibility.flatMap((result) => result.diagnostics)
  ];

  return {
    status: getStatusForDiagnostics(allDiagnostics),
    diagnostics,
    compatibility
  };
}
