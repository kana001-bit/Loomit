import type { SeamlintCheckReport } from "../commands/seamlintCheck.js";

export function formatSeamlintCheckJson(report: SeamlintCheckReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
