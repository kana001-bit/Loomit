import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

// 実バイナリ(dist/main.js)を子プロセスとして起動する CLI スモーク E2E。
// 他の CLI テストは runCli() を in-process で直呼びするので、main.ts の入口
// (process.argv の受け渡し / runCli の戻り値を process.exitCode に載せる配線)は
// この E2E だけが実プロセス境界で検証する。
// 既定の `pnpm test` は src を見る純粋な suite のままにするため、この e2e は
// `test/**/*.e2e.test.ts` として既定 config から exclude し、`pnpm test:e2e`
// (pnpm -r build で dist を建ててから vitest.e2e.config.ts で回す)で明示実行する。

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const distMain = join(workspaceRoot, "packages/cli/dist/main.js");
const fixturesRoot = join(workspaceRoot, "packages/core/test/fixtures");

interface LoomResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

// dist/main.js を `node dist/main.js <args>` として起動し、exit code と stdout/stderr を集める。
// main.ts は process.exit() ではなく process.exitCode を設定するので、正常終了時の終了コードがそのまま code に入る。
function runLoom(args: readonly string[]): Promise<LoomResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [distMain, ...args], { cwd: workspaceRoot });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise({ code: code ?? -1, stdout, stderr });
    });
  });
}

describe("loom CLI binary (dist/main.js) smoke", () => {
  beforeAll(() => {
    // dist が無いまま回すと spawn が意味不明な失敗をするので、建て忘れを明示的に案内する。
    if (!existsSync(distMain)) {
      throw new Error(
        `dist/main.js が見つかりません: ${distMain}\n先に \`pnpm -r build\` を実行するか、\`pnpm test:e2e\`(build 込み)で回してください。`
      );
    }
  });

  it("prints main help and exits 0", async () => {
    // 守る仕様: 実バイナリの `loom --help` は使い方を stdout に出し exit 0(argv の受け渡しと exit 0 の配線)。
    const result = await runLoom(["--help"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: loom <command>");
    expect(result.stderr).toBe("");
  });

  it("checks a valid project and exits 0", async () => {
    // 守る仕様: 実バイナリの check(妥当な project)は "Loomit check: ok" を出し exit 0。
    const result = await runLoom(["check", join(fixturesRoot, "valid-blouse")]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Loomit check: ok");
    expect(result.stderr).toBe("");
  });

  it("checks an invalid project and exits 1 (non-zero exitCode wiring)", async () => {
    // 守る仕様: 実バイナリの check(不正な project)は診断を出し exit 1。runCli の戻り値が process.exitCode に載ることを実プロセスで確認する。
    const result = await runLoom(["check", join(fixturesRoot, "length-mismatch")]);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain("CONNECTOR_LENGTH_MISMATCH");
  });

  it("rejects an unknown command with exit 2 on stderr", async () => {
    // 守る仕様: 実バイナリは未知コマンドを exit 2 で拒否し、その名を stderr に出す(usage error の配線)。
    const result = await runLoom(["frobnicate"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Unknown command: frobnicate");
  });
});
