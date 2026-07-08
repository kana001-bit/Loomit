import type { CheckReport, CompatibilityResult } from "../compatibility/checkReport.js";
import type { Diagnostic } from "./diagnostic.js";
import { getStatusForDiagnostics } from "./report.js";
import type { ReportStatus } from "./report.js";

export interface DoctorFinding {
  readonly code: string;
  readonly title: string;
  readonly detail: string;
  readonly target?: string;
  readonly suggestion?: readonly string[];
  readonly source?: {
    readonly rule?: string;
    readonly from?: string;
    readonly to?: string;
  };
}

export interface DoctorReport {
  readonly status: ReportStatus;
  readonly summary: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly findings: readonly DoctorFinding[];
}

export function createDoctorReport(checkReport: CheckReport): DoctorReport {
  const findings = [
    ...checkReport.diagnostics.map(createDiagnosticFinding),
    ...checkReport.compatibility.flatMap(createCompatibilityFindings)
  ];

  return {
    status: getStatusForDiagnostics([
      ...checkReport.diagnostics,
      ...checkReport.compatibility.flatMap((result) => result.diagnostics)
    ]),
    summary: createDoctorSummary(findings),
    diagnostics: checkReport.diagnostics,
    findings
  };
}

function createDiagnosticFinding(diagnostic: Diagnostic): DoctorFinding {
  return {
    code: diagnostic.code,
    title: formatDiagnosticTitle(diagnostic.code),
    detail: diagnostic.message,
    ...(diagnostic.target === undefined ? {} : { target: diagnostic.target }),
    ...(diagnostic.suggestion === undefined ? {} : { suggestion: diagnostic.suggestion })
  };
}

function createCompatibilityFindings(result: CompatibilityResult): readonly DoctorFinding[] {
  return result.diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    title: formatDiagnosticTitle(diagnostic.code),
    detail: explainCompatibilityDiagnostic(result, diagnostic),
    ...(diagnostic.target === undefined ? {} : { target: diagnostic.target }),
    ...(diagnostic.suggestion === undefined ? {} : { suggestion: diagnostic.suggestion }),
    source: {
      rule: result.rule,
      from: result.from,
      to: result.to
    }
  }));
}

function explainCompatibilityDiagnostic(
  result: CompatibilityResult,
  diagnostic: Diagnostic
): string {
  if (diagnostic.code === "CONNECTOR_LENGTH_MISMATCH") {
    return explainConnectorLengthMismatch(result);
  }

  if (diagnostic.code === "REQUIREMENT_RANGE_UNSATISFIED") {
    return explainRequirementRange(result);
  }

  if (diagnostic.code === "CONNECTOR_MISSING") {
    return `${result.from} references ${result.to}, but that connector is not available on the target part.`;
  }

  if (diagnostic.code === "CONNECTOR_JOIN_OPEN") {
    return `${result.from} is declared by only one part, so it has no seam partner to sew to. A connector joins two parts: add the mating part, fix a mismatched join id, or move an internal (self) seam to Seamlint.`;
  }

  if (diagnostic.code === "CONNECTOR_JOIN_OVERPAIRED") {
    return `Connector "${result.from}" is declared by more than two parts (${result.to}). A connector joins exactly two parts, so Loomit cannot tell which pair should be sewn; give the extra seams distinct join ids.`;
  }

  return diagnostic.message;
}

function explainConnectorLengthMismatch(result: CompatibilityResult): string {
  const actual = readConnectorLengthActual(result.actual);
  const expected = readToleranceExpected(result.expected);

  if (actual === undefined || expected === undefined) {
    return `${result.from} and ${result.to} do not satisfy the connector length rule.`;
  }

  return [
    `${result.from} is ${actual.fromLengthMm}mm and ${result.to} is ${actual.toLengthMm}mm.`,
    `The difference is ${actual.differenceMm}mm, but the allowed tolerance is ${expected.toleranceMm}mm.`
  ].join(" ");
}

function explainRequirementRange(result: CompatibilityResult): string {
  const actual = readRequirementActual(result.actual);
  const expected = formatExpectedRequirement(result.expected);

  if (actual === undefined || expected === "") {
    return `${result.to} does not satisfy the requirement from ${result.from}.`;
  }

  return `${result.from} requires ${result.to} to be ${expected}, but the actual value is ${String(actual.value)}.`;
}

function createDoctorSummary(findings: readonly DoctorFinding[]): string {
  if (findings.length === 0) {
    return "No problems found.";
  }

  if (findings.length === 1) {
    return "Found 1 problem.";
  }

  return `Found ${findings.length} problems.`;
}

function formatDiagnosticTitle(code: string): string {
  return code
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

interface ConnectorLengthActual {
  readonly fromLengthMm: number;
  readonly toLengthMm: number;
  readonly differenceMm: number;
}

function readConnectorLengthActual(actual: unknown): ConnectorLengthActual | undefined {
  if (!isRecord(actual)) {
    return undefined;
  }

  const { fromLengthMm, toLengthMm, differenceMm } = actual;

  if (
    typeof fromLengthMm !== "number" ||
    typeof toLengthMm !== "number" ||
    typeof differenceMm !== "number"
  ) {
    return undefined;
  }

  return {
    fromLengthMm,
    toLengthMm,
    differenceMm
  };
}

function readToleranceExpected(expected: unknown): { readonly toleranceMm: number } | undefined {
  if (!isRecord(expected) || typeof expected.toleranceMm !== "number") {
    return undefined;
  }

  return {
    toleranceMm: expected.toleranceMm
  };
}

function readRequirementActual(actual: unknown): { readonly value: unknown } | undefined {
  if (!isRecord(actual) || !("value" in actual)) {
    return undefined;
  }

  return {
    value: actual.value
  };
}

function formatExpectedRequirement(expected: unknown): string {
  if (!isRecord(expected)) {
    return "";
  }

  const parts: string[] = [];

  if (typeof expected.min === "number") {
    parts.push(`at least ${expected.min}`);
  }

  if (typeof expected.max === "number") {
    parts.push(`at most ${expected.max}`);
  }

  if (expected.equals !== undefined) {
    parts.push(`equal to ${String(expected.equals)}`);
  }

  if (Array.isArray(expected.includes)) {
    parts.push(`one of ${expected.includes.map(String).join(", ")}`);
  }

  return parts.join(" and ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
