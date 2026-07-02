import { createDiagnosticReport } from "../diagnostics/report.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { DiagnosticReport, ReportStatus } from "../diagnostics/report.js";

export interface FitMeasurementResult {
  readonly id: string;
  readonly status: ReportStatus;
  readonly bodyMeasurementCm: number;
  readonly garmentMeasurementCm: number;
  readonly easeCm: number;
  readonly source: {
    readonly partRole: string;
    readonly measurement: string;
  };
  readonly diagnostics: readonly Diagnostic[];
}

export interface FitReport extends DiagnosticReport {
  readonly measurements: readonly FitMeasurementResult[];
}

export function createFitReport(input: {
  readonly diagnostics?: readonly Diagnostic[];
  readonly measurements?: readonly FitMeasurementResult[];
} = {}): FitReport {
  const diagnostics = input.diagnostics ?? [];
  const measurements = input.measurements ?? [];
  const measurementDiagnostics = measurements.flatMap((measurement) => measurement.diagnostics);
  const report = createDiagnosticReport([...diagnostics, ...measurementDiagnostics]);

  return {
    ...report,
    diagnostics,
    measurements
  };
}
