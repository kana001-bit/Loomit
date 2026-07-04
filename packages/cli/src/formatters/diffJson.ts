import type { PartDiffReport } from "@loomit/core";

export function formatDiffJson(report: PartDiffReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
