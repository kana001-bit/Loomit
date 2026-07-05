import type { PartDiffReport } from "@loomit/core";

import { formatDiagnosticsText } from "./diagnosticsText.js";

export function formatDiffText(report: PartDiffReport): string {
  const lines = [`Loomit diff: ${report.status}`];

  lines.push(
    `From: ${report.from.name}@${report.from.variant} (${report.from.type})`,
    `To:   ${report.to.name}@${report.to.variant} (${report.to.type})`
  );

  // keep / discard 判断に効く要約を、詳細(diagnostics / changes)より先に出す。
  lines.push(
    "",
    "Summary:",
    `  silhouette impact: ${report.decisionSummary.silhouetteImpact}`,
    `  volume change:     ${report.decisionSummary.volumeChange}`,
    `  connection risk:   ${report.decisionSummary.connectionRisk}`,
    `  prototype notes:   ${report.decisionSummary.prototypeNoteSignal}`
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
      // why 行が「なぜ関連するか」(前提タグ＋変わったフィーチャ)を一行にまとめるので、旧 tags 行は畳む。
      lines.push(`    why: ${formatNoteReasons(note.reasons)}`);
      lines.push(`    test case: ${note.createsTestCase}`);

      for (const suggestion of note.suggestedChange) {
        lines.push(`    suggested_change: ${suggestion}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function formatNoteReasons(reasons: PartDiffReport["relatedNotes"][number]["reasons"]): string {
  const parts = reasons.map((reason) => {
    if (reason.kind === "applies-to-tags") {
      return `applies-to tags [${reason.tags.join(", ")}] (${reason.matchedOn})`;
    }

    return `changed ${reason.feature} [${reason.changedIds.join(", ")}]`;
  });

  // 理由が空になることは無い想定(最低でも applies-to-tags が入る)だが、念のため中立表現を置く。
  return parts.length > 0 ? parts.join("; ") : "related";
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
