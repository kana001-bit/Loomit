import type { MovementTestReport } from "@loomit/core";
import { formatDiagnosticsText } from "./diagnosticsText.js";

export function formatMovementTestText(report: MovementTestReport): string {
  const lines = [`Loomit test ${report.scenario}: ${report.status}`];

  if (report.diagnostics.length > 0) {
    lines.push("", "Diagnostics:", ...formatDiagnosticsText(report.diagnostics));
  }

  if (report.checks.length > 0) {
    lines.push("", "Checks:");

    for (const check of report.checks) {
      lines.push(`  [${check.status}] ${check.id}`);
      lines.push(`    reason: ${check.reason}`);
      lines.push(`    source: ${check.source}`);

      if (check.diagnostics.length > 0) {
        lines.push(...formatDiagnosticsText(check.diagnostics));
      }
    }
  }

  return `${lines.join("\n")}\n`;
}
