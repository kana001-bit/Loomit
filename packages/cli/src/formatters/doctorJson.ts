import type { DoctorReport } from "@loomit/core";

export function formatDoctorJson(report: DoctorReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
