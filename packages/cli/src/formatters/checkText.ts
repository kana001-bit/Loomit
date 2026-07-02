import type { CheckReport } from "@loomit/core";
import { formatDiagnosticsText } from "./diagnosticsText.js";

export function formatCheckText(report: CheckReport): string {
  const lines = [`Loomit check: ${report.status}`];

  if (report.diagnostics.length > 0) {
    lines.push("", "Diagnostics:", ...formatDiagnosticsText(report.diagnostics));
  }

  if (report.compatibility.length > 0) {
    lines.push("", "Compatibility:");

    for (const result of report.compatibility) {
      lines.push(`  [${result.status}] ${result.rule} ${result.from} -> ${result.to}`);

      if (result.diagnostics.length > 0) {
        lines.push(...formatDiagnosticsText(result.diagnostics));
      }
    }
  }

  return `${lines.join("\n")}\n`;
}
