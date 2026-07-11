// Seamlint が返す GeometryRequestReport の Loomit 側ミラー。Seamlint `src/types.ts` の
// GeometryRequestReport / CheckReport / Diagnostic と構造互換にしておき、subprocess handoff で
// 受け取った JSON をこの型として扱う。契約が正本(Seamlint 型)で、ここはその写し。

export type SeamlintGeometryReportStatus = "ok" | "warning" | "error";

export interface SeamlintGeometryDiagnostic {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly target: string;
  readonly message: string;
  readonly expected?: unknown;
  readonly actual?: unknown;
  readonly suggestion?: readonly string[];
}

export interface SeamlintGeometryCheckReport {
  readonly status: SeamlintGeometryReportStatus;
  readonly target: string;
  readonly lengthMm: number | null;
  readonly diagnostics: readonly SeamlintGeometryDiagnostic[];
}

export interface SeamlintGeometryRequestReport {
  readonly status: SeamlintGeometryReportStatus;
  readonly target: string;
  readonly diagnostics: readonly SeamlintGeometryDiagnostic[];
  readonly reports: readonly SeamlintGeometryCheckReport[];
}

// Seamlint の stdout JSON を最小限だけ検証してレポートとして受け取る。契約がずれた出力(status や
// reports が欠落など)を沈黙して通さないための guard。形が違えば undefined を返し、呼び出し側が
// 「Seamlint が不正な出力を返した」として扱えるようにする。
export function parseSeamlintGeometryReport(text: string): SeamlintGeometryRequestReport | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const candidate = value as {
    status?: unknown;
    target?: unknown;
    diagnostics?: unknown;
    reports?: unknown;
  };

  if (
    !isReportStatus(candidate.status) ||
    typeof candidate.target !== "string" ||
    !Array.isArray(candidate.diagnostics) ||
    !candidate.diagnostics.every(isGeometryDiagnostic) ||
    !Array.isArray(candidate.reports) ||
    !candidate.reports.every(isGeometryCheckReport)
  ) {
    return undefined;
  }

  return value as SeamlintGeometryRequestReport;
}

function isGeometryDiagnostic(value: unknown): value is SeamlintGeometryDiagnostic {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as {
    severity?: unknown;
    code?: unknown;
    target?: unknown;
    message?: unknown;
    suggestion?: unknown;
  };

  return (
    isDiagnosticSeverity(candidate.severity) &&
    typeof candidate.code === "string" &&
    typeof candidate.target === "string" &&
    typeof candidate.message === "string" &&
    (candidate.suggestion === undefined ||
      (Array.isArray(candidate.suggestion) && candidate.suggestion.every((item) => typeof item === "string")))
  );
}

function isGeometryCheckReport(value: unknown): value is SeamlintGeometryCheckReport {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as {
    status?: unknown;
    target?: unknown;
    lengthMm?: unknown;
    diagnostics?: unknown;
  };

  return (
    isReportStatus(candidate.status) &&
    typeof candidate.target === "string" &&
    (typeof candidate.lengthMm === "number" || candidate.lengthMm === null) &&
    Array.isArray(candidate.diagnostics) &&
    candidate.diagnostics.every(isGeometryDiagnostic)
  );
}

function isDiagnosticSeverity(
  value: unknown
): value is SeamlintGeometryDiagnostic["severity"] {
  return value === "info" || value === "warning" || value === "error";
}

function isReportStatus(value: unknown): value is SeamlintGeometryReportStatus {
  return value === "ok" || value === "warning" || value === "error";
}
