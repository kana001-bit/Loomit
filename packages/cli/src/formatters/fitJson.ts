import type { FitReport } from "@loomit/core";

export function formatFitJson(report: FitReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
