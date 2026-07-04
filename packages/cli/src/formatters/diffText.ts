import type { PartDiffReport } from "@loomit/core";

import { formatDiagnosticsText } from "./diagnosticsText.js";

export function formatDiffText(report: PartDiffReport): string {
  const lines = [`Loomit diff: ${report.status}`];

  lines.push(
    `From: ${report.from.name}@${report.from.variant} (${report.from.type})`,
    `To:   ${report.to.name}@${report.to.variant} (${report.to.type})`
  );

  if (report.diagnostics.length > 0) {
    lines.push("", "Diagnostics:", ...formatDiagnosticsText(report.diagnostics));
  }

  if (report.changes.length === 0) {
    lines.push("", "No semantic changes.");
  } else {
    lines.push("", "Changes:");

    for (const change of report.changes) {
      if (change.kind === "added") {
        lines.push(`  [added] ${change.feature} ${change.id}`);
        continue;
      }

      if (change.kind === "removed") {
        lines.push(`  [removed] ${change.feature} ${change.id}`);
        continue;
      }

      lines.push(`  [modified] ${change.feature} ${change.id}`);

      for (const fieldChange of change.changes) {
        lines.push(
          `    - ${fieldChange.field}: ${formatValue(fieldChange.before)} -> ${formatValue(fieldChange.after)}`
        );
      }
    }
  }

  if (report.relatedNotes.length > 0) {
    lines.push("", "Related Prototype Notes:");

    for (const note of report.relatedNotes) {
      lines.push(`  - ${note.id} (${note.result}, ${note.date})`);
      lines.push(`    issue: ${note.issue}`);
      lines.push(`    tags: ${note.appliesTo.join(", ")}`);

      for (const suggestion of note.suggestedChange) {
        lines.push(`    suggested_change: ${suggestion}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function formatValue(value: boolean | number | string | readonly string[] | undefined): string {
  if (value === undefined) {
    return "<missing>";
  }

  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return String(value);
}
