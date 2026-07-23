import type { TruerRequestReport } from "../commands/truerRequest.js";

export function formatTruerRequestJson(report: TruerRequestReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
