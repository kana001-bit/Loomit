import { createDiagnostic } from "../diagnostics/diagnostic.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";

export interface FsErrorContext {
  /** 操作に対する安定した diagnostic code(例: "PROJECT_CREATE_FAILED")。 */
  readonly code: string;
  /** 失敗した操作を説明する日英併記のベースメッセージ。 */
  readonly message: string;
  readonly target: string;
  /** errno を特定できないときに使うフォールバックの suggestion。 */
  readonly suggestion?: readonly string[];
}

interface ErrnoDetail {
  readonly reason: string;
  readonly suggestion: readonly string[];
}

// Node のファイルシステムエラーは `.code` に errno の文字列(EACCES, ENOSPC, ...)を持つ。非標準の
// throw 値でもマッパーが落ちないよう、防御的に読み取る。
export function getErrno(error: unknown): string | undefined {
  if (error instanceof Error && "code" in error) {
    // 意図的に unknown: Error の .code は型が付かないため、下で string に絞り込む。
    const code: unknown = error.code;
    return typeof code === "string" ? code : undefined;
  }

  return undefined;
}

function errnoDetail(errno: string | undefined): ErrnoDetail | undefined {
  switch (errno) {
    case "EACCES":
    case "EPERM":
      return {
        reason: "権限がありません / permission denied",
        suggestion: [
          "ファイルとディレクトリのアクセス権限を確認してください。 / Check file and directory permissions."
        ]
      };
    case "ENOSPC":
      return {
        reason: "ディスクの空き容量が不足しています / no space left on device",
        suggestion: ["空き容量を確保してから再実行してください。 / Free up disk space and try again."]
      };
    case "EROFS":
      return {
        reason: "読み取り専用のファイルシステムです / read-only filesystem",
        suggestion: ["書き込み可能な場所を指定してください。 / Choose a writable location."]
      };
    case "EEXIST":
      return {
        reason: "すでに存在します / already exists",
        suggestion: [
          "別の名前を使うか、既存のものを削除してください。 / Use another name, or remove the existing entry."
        ]
      };
    case "ENOENT":
      return {
        reason: "パスが見つかりません / path not found",
        suggestion: ["パスが正しいか確認してください。 / Check that the path is correct."]
      };
    default:
      return undefined;
  }
}

// 捕捉したファイルシステムエラーを、説明可能な Diagnostic に変換する。権限・容量不足・既存・不在を
// それぞれ別の理由と suggestion にし、汎用的な「失敗しました」1つに潰さない。
export function describeFsError(error: unknown, context: FsErrorContext): Diagnostic {
  const detail = errnoDetail(getErrno(error));

  return createDiagnostic({
    severity: "error",
    code: context.code,
    message: detail === undefined ? context.message : `${context.message} (${detail.reason})`,
    target: context.target,
    suggestion: detail?.suggestion ?? context.suggestion ?? []
  });
}
