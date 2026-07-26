import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// git を shell 無しの args 配列で呼ぶ。git は本物の実行ファイル(Windows でも git.exe)なので
// slnt のような .cmd shim 問題は無く、PATH 解決に shell を要さない。stdout を集めて返す。
// history を Git に委譲する方針(design-history 参照)上、git 連携は環境の副作用なので core ではなく
// この CLI 層に置き、core の diff は pure なまま保つ。
interface GitResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
}

function runGit(args: readonly string[], cwd: string): Promise<GitResult> {
  return new Promise<GitResult>((resolve) => {
    const child = spawn("git", args, { cwd });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (result: GitResult): void => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    // git 未検出(ENOENT)等は非0終了ではなく error イベントで来るので、失敗として畳む。
    child.on("error", (error: NodeJS.ErrnoException) => {
      settle({ ok: false, stdout, stderr: error.message, code: null });
    });
    child.on("close", (code) => {
      settle({ ok: code === 0, stdout, stderr, code });
    });
  });
}

// リポジトリ解決の結果。失敗は「git を起動できなかった(未検出/権限)」と「git は走ったが拒否した
// (repo 外 / dubious ownership / 権限 等)」を分ける。呼び出し側が正しい直し方を提示するため。
export type GitRepoRootResult =
  | { readonly ok: true; readonly repoRoot: string }
  | {
      readonly ok: false;
      readonly reason: "git-unavailable" | "git-failed";
      readonly message: string;
    };

// cwd の Git repo root を解決する。失敗はすべて undefined に潰さず、理由と git の文面を添えて返す。
export async function resolveGitRepoRoot(cwd: string): Promise<GitRepoRootResult> {
  const result = await runGit(["rev-parse", "--show-toplevel"], cwd);

  if (result.ok) {
    const root = result.stdout.trim();
    if (root.length > 0) {
      return { ok: true, repoRoot: root };
    }
    return { ok: false, reason: "git-failed", message: "git rev-parse returned no toplevel path." };
  }

  // code === null は spawn 自体の失敗(git 未検出/権限)。それ以外は git が走って非0終了(repo 外等)。
  if (result.code === null) {
    return {
      ok: false,
      reason: "git-unavailable",
      message: result.stderr.trim() || "Git could not be started."
    };
  }
  return {
    ok: false,
    reason: "git-failed",
    message: result.stderr.trim() || `git exited ${result.code}.`
  };
}

// cwd の位置(repo root から見た相対パス)の解決結果。root 直下なら prefix は空文字。
export type GitPrefixResult =
  | { readonly ok: true; readonly prefix: string }
  | { readonly ok: false; readonly message: string };

// cwd が repo root から見てどこにあるかを git 自身に答えさせる(POSIX 区切り・末尾 `/` 付き・root なら空)。
//
// relative(repoRoot, cwd) で自前計算してはいけない: repoRoot は git の出力(解決済みの実パス)、cwd は Node
// 側の文字列で、同じディレクトリを指していても表記が食い違う環境がある ── Windows の 8.3 短縮名
// (CI runner の TEMP が `C:\Users\RUNNER~1\...`)、macOS の `/var` -> `/private/var`、symlink 経由の cwd。
// 食い違うと relative() が repo 外へ登る相対パスを返し、worktree に join した結果が元の作業ツリーへ戻る。
// すると2版とも同じ現在の作業ツリーを読み、diff は**エラーを出さずに「差分なし」と答える**(false negative)。
// git に訊けばこの一族がまとめて消える(repoRoot を得たのと同じ git・同じ cwd の答えなので必ず整合する)。
export async function resolveProjectPrefix(cwd: string): Promise<GitPrefixResult> {
  const result = await runGit(["rev-parse", "--show-prefix"], cwd);

  if (!result.ok) {
    return { ok: false, message: result.stderr.trim() || `git exited ${result.code ?? "null"}.` };
  }

  // root 直下なら改行だけが返る = 空文字。末尾の `/` は join が吸収するので落とさない。
  return { ok: true, prefix: result.stdout.trim() };
}

// ref が commit として解決できれば SHA を返し、できなければ undefined。worktree を作る前に
// 不正な revision を弾いて、明快なエラーにするために使う(`^{commit}` で tag/branch も commit に寄せる)。
export async function resolveRef(repoRoot: string, ref: string): Promise<string | undefined> {
  const result = await runGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], repoRoot);
  if (!result.ok) {
    return undefined;
  }
  const sha = result.stdout.trim();
  return sha.length > 0 ? sha : undefined;
}

// ref をデタッチした一時 worktree に展開し、その path で fn を実行してから必ず後始末する。
// 既存の project/part loader をそのままそのパスに向けられるので、diff 本体を再実装せず revision 差分を作れる。
export async function withRefWorktree<T>(
  repoRoot: string,
  ref: string,
  fn: (worktreePath: string) => Promise<T>
): Promise<T> {
  // worktree add は「存在しない or 空」の path を要求するので、mkdir せず一意名だけ作って git に作らせる。
  const worktreePath = join(tmpdir(), `loomit-diff-${randomUUID()}`);
  const added = await runGit(
    ["worktree", "add", "--detach", "--quiet", worktreePath, ref],
    repoRoot
  );
  if (!added.ok) {
    throw new Error(
      `Could not create a Git worktree for "${ref}": ${added.stderr.trim() || `git exited ${added.code ?? "null"}`}`
    );
  }

  try {
    return await fn(worktreePath);
  } finally {
    // 後始末はベストエフォート。失敗しても diff 結果は返す(tmp に残るだけ)。
    await runGit(["worktree", "remove", "--force", worktreePath], repoRoot);
  }
}
