import type { TestSuggestionReport } from "@loomit/core";

export function formatTestSuggestionsJson(report: TestSuggestionReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
