import type { BuildReport } from "@loomit/core";
import { formatDiagnosticsText } from "./diagnosticsText.js";

export function formatBuildText(report: BuildReport): string {
  const lines = [`Loomit build: ${report.status}`];

  lines.push(`output: ${report.outputDir}`);
  lines.push(`manifest: ${report.manifestFilePath}`);

  if (report.diagnostics.length > 0) {
    lines.push("", "Diagnostics:", ...formatDiagnosticsText(report.diagnostics));
  }

  if (report.manifest !== undefined && report.manifest.assets.length > 0) {
    lines.push("", "Assets:");

    for (const asset of report.manifest.assets) {
      lines.push(`  ${asset.role}.${asset.kind}: ${asset.sourcePath} -> ${asset.outputPath}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
