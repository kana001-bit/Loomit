import type { MovementTestReport } from "@loomit/core";

export function formatMovementTestJson(report: MovementTestReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
