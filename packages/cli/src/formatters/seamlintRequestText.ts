import { formatDiagnosticsText } from "./diagnosticsText.js";
import type { SeamlintRequestReport } from "../commands/seamlintRequest.js";

export function formatSeamlintRequestText(report: SeamlintRequestReport): string {
  const lines = [`Loomit slnt request: ${report.status}`];

  lines.push(`parts: ${report.request.parts.length}`);
  lines.push(`checks: ${report.request.checks.length}`);

  if (report.request.checks.length > 0) {
    lines.push("", "Checks:");

    // check.id は kind・両側の part.connector・range id まで含む一意な識別子。connector 単位の要約だと
    // 同じ connector 上の複数 subrange(gathered など)が同一行に潰れて手動レビューで見分けられないので、
    // id をそのまま出す。
    for (const check of report.request.checks) {
      lines.push(`  - ${check.id}`);
    }
  }

  if (report.diagnostics.length > 0) {
    lines.push("", "Diagnostics:", ...formatDiagnosticsText(report.diagnostics));
  }

  return `${lines.join("\n")}\n`;
}
