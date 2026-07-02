import type { FitReport } from "@loomit/core";
import { formatDiagnosticsText } from "./diagnosticsText.js";

export function formatFitText(report: FitReport): string {
  const lines = [`Loomit fit: ${report.status}`];

  if (report.diagnostics.length > 0) {
    lines.push("", "Diagnostics:", ...formatDiagnosticsText(report.diagnostics));
  }

  if (report.measurements.length > 0) {
    lines.push("", "Measurements:");

    for (const measurement of report.measurements) {
      lines.push(
        `  [${measurement.status}] ${measurement.id} body=${measurement.bodyMeasurementCm}cm garment=${measurement.garmentMeasurementCm}cm ease=${measurement.easeCm}cm`
      );
      lines.push(`    source: ${measurement.source.partRole}.${measurement.source.measurement}`);

      if (measurement.diagnostics.length > 0) {
        lines.push(...formatDiagnosticsText(measurement.diagnostics));
      }
    }
  }

  return `${lines.join("\n")}\n`;
}
