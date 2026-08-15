import { formatDiagnosticSubject } from "loomit-core";
import type { Diagnostic, DiagnosticSubject } from "loomit-core";

export function formatDiagnosticsText(diagnostics: readonly Diagnostic[]): readonly string[] {
  return diagnostics.flatMap((diagnostic) => {
    const lines = [
      `  [${diagnostic.severity}] ${diagnostic.code}${formatTarget(diagnostic.target)}`,
      `    ${diagnostic.message}`
    ];

    for (const suggestion of diagnostic.suggestion ?? []) {
      lines.push(`    suggestion: ${suggestion}`);
    }

    return lines;
  });
}

function formatTarget(target: DiagnosticSubject | undefined): string {
  return target === undefined ? "" : ` ${formatDiagnosticSubject(target)}`;
}
