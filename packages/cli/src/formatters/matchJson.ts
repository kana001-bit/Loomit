import type { MatchReport } from "../commands/match.js";

export function formatMatchJson(report: MatchReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
