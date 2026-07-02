import type { DoctorReport } from "@loomit/core";

export function formatDoctorText(report: DoctorReport): string {
  const lines = [`Loomit doctor: ${report.status}`, report.summary];

  if (report.findings.length > 0) {
    lines.push("", "Findings:");

    for (const finding of report.findings) {
      lines.push(`  [${finding.code}] ${finding.title}`);

      if (finding.target !== undefined) {
        lines.push(`    target: ${finding.target}`);
      }

      if (finding.source !== undefined) {
        lines.push(`    source: ${formatSource(finding.source)}`);
      }

      lines.push(`    ${finding.detail}`);

      for (const suggestion of finding.suggestion ?? []) {
        lines.push(`    suggestion: ${suggestion}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function formatSource(source: NonNullable<DoctorReport["findings"][number]["source"]>): string {
  const parts = [];

  if (source.rule !== undefined) {
    parts.push(source.rule);
  }

  if (source.from !== undefined && source.to !== undefined) {
    parts.push(`${source.from} -> ${source.to}`);
  }

  return parts.join(" ");
}
