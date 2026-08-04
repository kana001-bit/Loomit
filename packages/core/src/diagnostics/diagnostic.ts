import type { DiagnosticCode, RegisteredDiagnosticCode } from "./codes.js";

// 注記: Loomit 自身が発行する診断は今のところ warning と error だけで、"info" を出す箇所は無い。
// それでも level を残す理由は2つ。使われていないからといって削らないこと。
//
// 1. **公開契約だから。** severity は report JSON にそのまま出る。`--format json` の消費者が
//    "info" で分岐していれば、union を狭めるのは breaking change になる。
// 2. **注入された rule が出せるから。** FitRule / MovementTestRule / CompatibilityRule は公開の
//    拡張点で、呼び出し側の rule は Diagnostic を自分で組み立てる。severity に "info" を選ぶ道を
//    塞ぐ理由が無い(拡張コードを X_ 接頭辞で許しているのと同じ立て付け)。
//
// なお `loom slnt check` の出力に `[info]` が現れることはあるが、それは Seamlint 由来の
// SeamlintGeometryDiagnostic["severity"] で、この型とは独立に宣言されている(geometryReport.ts)。
// ここから "info" を外しても Seamlint 側の型も表示も変わらないので、維持の根拠にはならない。
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
