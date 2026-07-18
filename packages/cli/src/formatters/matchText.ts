import { formatDiagnosticsText } from "./diagnosticsText.js";
import type { MatchReport } from "../commands/match.js";

export function formatMatchText(report: MatchReport): string {
  const lines = [`Loomit match ${report.roleA} <-> ${report.roleB}: ${report.status}`];

  lines.push(`seams: ${report.seamCount}`);

  const seamlint = report.seamlint;
  if (seamlint.kind === "ran") {
    lines.push(`seamlint: ${seamlint.report.status}`);

    if (seamlint.report.reports.length > 0) {
      lines.push("", "Seams:");

      for (const check of seamlint.report.reports) {
        const length = check.lengthMm === null ? "n/a" : `${check.lengthMm} mm`;
        lines.push(`  - ${check.target}: ${check.status} (${length})`);

        for (const diagnostic of check.diagnostics) {
          lines.push(`      [${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`);
        }
      }
    }
  } else if (seamlint.kind === "skipped") {
    lines.push(`seamlint: skipped (${seamlint.reason})`);
  } else {
    lines.push(`seamlint: unavailable (${seamlint.code})`);
  }

  if (report.diagnostics.length > 0) {
    lines.push("", "Diagnostics:", ...formatDiagnosticsText(report.diagnostics));
  }

  return `${lines.join("\n")}\n`;
}
