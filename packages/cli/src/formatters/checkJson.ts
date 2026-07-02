import type { CheckReport } from "@loomit/core";

export function formatCheckJson(report: CheckReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
