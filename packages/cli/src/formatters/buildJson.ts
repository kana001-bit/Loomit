import type { BuildReport } from "@loomit/core";

export function formatBuildJson(report: BuildReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
