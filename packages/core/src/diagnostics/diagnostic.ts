import type { DiagnosticCode, RegisteredDiagnosticCode } from "./codes.js";

export const diagnosticSeverities = ["info", "warning", "error"] as const;

export type DiagnosticSeverity = (typeof diagnosticSeverities)[number];

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  // 語彙の正本は codes.ts。string ではなく union にしてあるので、発行側で綴りを変えると、その code に
  // 依存している分岐(doctorReport の説明マッピング等)がコンパイルエラーとして現れる。
  //
  // ここが CustomDiagnosticCode まで許すのは、注入された rule が組み立てた診断を report に載せるため。
  // Loomit 自身の発行は createDiagnostic 側で登録済みコードだけに絞る。
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly target?: string;
  readonly suggestion?: readonly string[];
}

// Loomit 自身が発行する診断。code は必ずレジストリに登録済みのものに限る。
export interface RegisteredDiagnostic extends Diagnostic {
  readonly code: RegisteredDiagnosticCode;
}

// Loomit 本体の発行口。入力を RegisteredDiagnostic に絞ることで、本体が未登録の `X_` コードを
// 出せないようにする(拡張コードは注入された rule が Diagnostic を直接組み立てて使う)。
export function createDiagnostic(input: RegisteredDiagnostic): RegisteredDiagnostic {
  return input;
}
