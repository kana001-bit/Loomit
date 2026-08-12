import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

// `loom` という名前が install されたときの配線(package.json の `bin` と shebang)を見る E2E。
// main-smoke.e2e.test.ts は `node dist/main.js` として起動するので node を明示的に呼んでおり、
// bin も shebang も一度も通らない。どちらを壊しても全テストが緑のまま通り、壊れるのは
// `pnpm link --global` した後の `loom` だけ、という穴をここで塞ぐ。
// docs/development.md はその link を実際に案内しているので、案内先が動くことは仕様。

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = join(packageRoot, "../..");
const distMain = join(packageRoot, "dist/main.js");
const srcMain = join(packageRoot, "src/main.ts");
const packageJsonPath = join(packageRoot, "package.json");

const NODE_SHEBANG = "#!/usr/bin/env node";

interface DirectRunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

// package.json は信頼できない入力の境界なので unknown で受けて形を絞る。
// 形が違えば「`loom` という名前を作る宣言そのものが壊れている」ことなので、理由を添えて落とす。
function readBinLoom(text: string): string {
  const parsed: unknown = JSON.parse(text);
  const bin: unknown =
    typeof parsed === "object" && parsed !== null ? (parsed as { bin?: unknown }).bin : undefined;
  const loom: unknown =
    typeof bin === "object" && bin !== null ? (bin as { loom?: unknown }).loom : undefined;
  if (typeof loom !== "string") {
    throw new Error(
      `packages/cli/package.json に bin.loom (string) がありません: ${JSON.stringify(bin)}`
    );
  }
  return loom;
}

// 1 行目だけを取り出す(CRLF でチェックアウトされていても shebang 行を比較できるように \r を落とす)。
function firstLine(text: string): string {
  return (text.split("\n", 1)[0] ?? "").replace(/\r$/, "");
}

// node を介さずファイルそのものを起動する。shebang が効いていなければここで失敗する。
function runDirect(args: readonly string[]): Promise<DirectRunResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(distMain, [...args], { cwd: workspaceRoot });
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

describe("loom CLI bin entry (package.json bin / shebang)", () => {
  beforeAll(() => {
    // dist が無いまま回すと spawn が意味不明な失敗をするので、建て忘れを明示的に案内する。
    if (!existsSync(distMain)) {
      throw new Error(
        `dist/main.js が見つかりません: ${distMain}\n先に \`pnpm -r build\` を実行するか、\`pnpm test:e2e\`(build 込み)で回してください。`
      );
    }
  });

  it("declares bin.loom as the same built file the smoke E2E starts", async () => {
    // 守る仕様: package.json の bin.loom が指す先は build 後に実在し、かつ他の e2e が起動している
    // dist/main.js と同一ファイルである。ずれると `pnpm link --global` で入る `loom` は、誰も
    // テストしていないファイル(build の outDir を変えた場合は存在しないファイル)を指す。
    const binLoom = readBinLoom(await readFile(packageJsonPath, "utf8"));

    // 失敗時に両辺とも同じ接頭辞で切り詰められて読めなくなるので、宣言値そのものを message に出す。
    expect(
      resolve(packageRoot, binLoom),
      `package.json の bin.loom ("${binLoom}") が dist/main.js を指していません`
    ).toBe(resolve(distMain));
    expect(existsSync(distMain)).toBe(true);
  });

  it("keeps the node shebang on the built entry", async () => {
    // 守る仕様: dist/main.js の 1 行目が `#!/usr/bin/env node` で、src/main.ts の 1 行目と一致する。
    // 消えても `node dist/main.js` は動くので他の e2e は緑のまま通り、POSIX で `loom` を直接
    // 起動したときだけ壊れる。src とも突き合わせるのは、build が落としたのか元から無いのかを
    // 切り分けるため。
    // 空振りでないことを実測済み(2026-08-12): dist/main.js の 1 行目だけ削ると、この 1 件が
    // `expected 'import { pathToFileURL } ...' to be '#!/usr/bin/env node'` で落ち、
    // main-smoke の 4 件は全部緑のまま通った(= このテストが無ければ誰も気付かない)。
    const distFirst = firstLine(await readFile(distMain, "utf8"));
    const srcFirst = firstLine(await readFile(srcMain, "utf8"));

    expect(srcFirst).toBe(NODE_SHEBANG);
    expect(distFirst).toBe(NODE_SHEBANG);
  });

  // Windows は .js を直接 exec できない(shebang の概念が無く、`loom` は npm が生成する .cmd/.ps1
  // shim 経由で node を呼ぶ)。ここで見たいのは shebang 行が実際に効くかなので POSIX に限る。
  // Windows 側の配線は上の bin.loom テストが受け持つ。CI は ubuntu と windows の両方を回すので、
  // この 1 件は ubuntu leg で実行される。
  it.skipIf(process.platform === "win32")(
    "runs as a command without an explicit node interpreter",
    async () => {
      // 守る仕様: dist/main.js を node 経由でなく直接起動しても CLI として動く(= shebang が効く)。
      // 実行ビットは npm/pnpm が link 時に付けるもので tsc は付けないため、shebang の検証だけを
      // 切り出せるようテスト側で付けてから起動する(付けないと EACCES になり、shebang が壊れた
      // ときと区別が付かない)。
      await chmod(distMain, 0o755);

      const result = await runDirect(["--help"]);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Usage: loom <command>");
    }
  );
});
