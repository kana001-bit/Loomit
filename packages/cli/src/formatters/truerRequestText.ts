import { formatDiagnosticsText } from "./diagnosticsText.js";
import type { TruerRequestReport } from "../commands/truerRequest.js";

export function formatTruerRequestText(report: TruerRequestReport): string {
  const lines = [`Loomit truer request: ${report.status}`];

  lines.push(`parts: ${report.payload.parts.length}`);
  lines.push(`connectors: ${report.payload.connectors.length}`);
  lines.push(`params: ${Object.keys(report.payload.params).length}`);

  if (report.payload.parts.length > 0) {
    lines.push("", "Parts:");

    // part ごとに拘束依存(dependsOn)の occurrence 数を出す。connector ではなく part 単位で依存を出す設計なので
    // (connector では辺を絞れない = [C6])、要約も part 単位にする。
    for (const part of report.payload.parts) {
      lines.push(`  - ${part.partId} (${part.piece}): ${part.dependsOn.length} occurrences`);
    }
  }

  if (report.diagnostics.length > 0) {
    lines.push("", "Diagnostics:", ...formatDiagnosticsText(report.diagnostics));
  }

  return `${lines.join("\n")}\n`;
}
