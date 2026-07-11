import type { SeamlintRequestReport } from "../commands/seamlintRequest.js";

export function formatSeamlintRequestJson(report: SeamlintRequestReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
