import type { DiagnosticCode, RegisteredDiagnosticCode } from "./codes.js";
import type { DiagnosticSubject } from "./subject.js";

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
  // 「プロジェクトの中のどれについてか」。構造の正本は subject.ts で、表示文字列は formatter が組む。
  //
  // **ここは常に構造。** `--format json` に出るのはこの型なので、string と構造が混ざると消費側は
  // 両方を扱う分岐を書く羽目になる。
  // **移行中の未分類は `{ kind: "text" }` として持つ。** 生の string がここに入る道は型として無い。
  readonly target?: DiagnosticSubject;
  readonly suggestion?: readonly string[];
}

// Loomit 自身が発行する診断。code は必ずレジストリに登録済みのものに限る。
export interface RegisteredDiagnostic extends Diagnostic {
  readonly code: RegisteredDiagnosticCode;
}

// Loomit 本体の発行口。入力を RegisteredDiagnostic に絞ることで、本体が未登録の `X_` コードを
// 出せないようにする(拡張コードは注入された rule が Diagnostic を直接組み立てて使う)。
//
// **移行のための受け口はここに置かない。** 一時的に `target?: DiagnosticSubject | string` を受ける案は、
// 匿名の型で書いても公開シグネチャの一部なので、あとで `| string` を落とすときに「今は正しくコンパイル
// できている呼び出し」を壊す破壊的変更になる。まだ構造化していない emit 箇所は、呼び出し側で
// `{ kind: "text" }` で包んで書く(そう書いてあること自体が「まだ分類していない」の印になり、
// 残っている箇所は diagnostic-text-targets.test.ts が一覧で固定している)。
export function createDiagnostic(input: RegisteredDiagnostic): RegisteredDiagnostic {
  return input;
}
