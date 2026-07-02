import type { TestSuggestionReport } from "@loomit/core";
import { formatDiagnosticsText } from "./diagnosticsText.js";

export function formatTestSuggestionsText(report: TestSuggestionReport): string {
  const lines = [`Loomit suggest-tests: ${report.status}`];

  if (report.diagnostics.length > 0) {
    lines.push("", "Diagnostics:", ...formatDiagnosticsText(report.diagnostics));
  }

  appendSuggestions(lines, "Recommended", report.recommended);
  appendSuggestions(lines, "Optional", report.optional);
  appendSuggestions(lines, "Skipped", report.skipped);

  return `${lines.join("\n")}\n`;
}

function appendSuggestions(
  lines: string[],
  title: string,
  suggestions: TestSuggestionReport["recommended"]
): void {
  if (suggestions.length === 0) {
    return;
  }

  lines.push("", `${title}:`);

  for (const suggestion of suggestions) {
    lines.push(`  - ${suggestion.scenario}`);
    lines.push(`    reason: ${suggestion.reason}`);
    lines.push(`    source: ${suggestion.source}`);

    if (suggestion.noteId !== undefined) {
      lines.push(`    note: ${suggestion.noteId}`);
    }
  }
}
