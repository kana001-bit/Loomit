import type { Diagnostic, DiagnosticSeverity } from "./diagnostic.js";

export type ReportStatus = "ok" | "warning" | "error";

const severityToStatus: Record<DiagnosticSeverity, ReportStatus> = {
  info: "ok",
  warning: "warning",
  error: "error"
};

const statusRank: Record<ReportStatus, number> = {
  ok: 0,
  warning: 1,
  error: 2
};

export interface DiagnosticReport {
  readonly status: ReportStatus;
  readonly diagnostics: readonly Diagnostic[];
}

export function getStatusForDiagnostics(diagnostics: readonly Diagnostic[]): ReportStatus {
  return diagnostics.reduce<ReportStatus>((currentStatus, diagnostic) => {
    const nextStatus = severityToStatus[diagnostic.severity];
    return statusRank[nextStatus] > statusRank[currentStatus] ? nextStatus : currentStatus;
  }, "ok");
}

export function createDiagnosticReport(diagnostics: readonly Diagnostic[] = []): DiagnosticReport {
  return {
    status: getStatusForDiagnostics(diagnostics),
    diagnostics
  };
}
