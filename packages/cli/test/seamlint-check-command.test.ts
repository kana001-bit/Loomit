import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  createSubprocessSeamlintRunner,
  quoteForCmd,
  resolveExecutable,
  runSeamlintCheckCommand
} from "../src/commands/seamlintCheck.js";
import type { SeamlintRunResult, SeamlintRunner } from "../src/commands/seamlintCheck.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../../core/test/fixtures");

function fakeRunner(result: SeamlintRunResult): { runner: SeamlintRunner; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    runner: {
      run: async (requestJson: string): Promise<SeamlintRunResult> => {
        calls.push(requestJson);
        return result;
      }
    }
  };
}

// 「Seamlint を呼ばずに終わる」ことを守るテスト用の runner。以前は code: "SHOULD_NOT_RUN" という
// 実在しない診断コードを返すダミーだったが、返り値は誰も検査しないので呼ばれても静かに素通りしていた。
//
// 呼ばれたら「calls に記録してから throw」する。throw は呼び出しをその場で落とし、calls への記録は
// 呼び出し側が throw を握り潰した場合に後段の `expect(calls).toEqual([])` で捉えるための保険。
// 記録しないと calls が常に空になり、そのアサーションが無条件に通る恒真検査に化ける。
function neverCalledRunner(): { runner: SeamlintRunner; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    runner: {
      run: async (requestJson: string): Promise<SeamlintRunResult> => {
        calls.push(requestJson);
        throw new Error("Seamlint runner must not be called in this scenario");
      }
    }
  };
}

function collect() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (text: string) => {
        stdout.push(text);
      },
      stderr: (text: string) => {
        stderr.push(text);
      }
    }
  };
}

describe("runSeamlintCheckCommand", () => {
  it("materializes geometry, hands a self-contained request to the runner, and reports a passing run", async () => {
    // 守る仕様: slnt check は geometry を materialize して self-contained request(各 part に inline geometryText)を runner に渡し、成功実行を報告する。
    const seamlintReport = {
      status: "ok" as const,
      target: "geometry-request",
      diagnostics: [],
      reports: [{ status: "ok" as const, target: "body.armhole/sleeve.armhole", lengthMm: 460, diagnostics: [] }]
    };
    const { runner, calls } = fakeRunner({ ok: true, report: seamlintReport, exitCode: 0 });
    const out = collect();

    const exitCode = await runSeamlintCheckCommand([join(fixturesRoot, "valid-blouse"), "--format", "json"], {
      cwd: fixturesRoot,
      stdout: out.io.stdout,
      stderr: out.io.stderr,
      runner
    });

    const report = JSON.parse(out.stdout.join("")) as {
      readonly status: string;
      readonly checksCount: number;
      readonly seamlint: { readonly kind: string; readonly report?: { readonly status: string } };
    };

    expect(exitCode).toBe(0);
    expect(report.status).toBe("ok");
    expect(report.checksCount).toBe(1);
    expect(report.seamlint.kind).toBe("ran");
    expect(report.seamlint.report?.status).toBe("ok");
    expect(out.stderr).toEqual([]);

    // request が self-contained(各 part に inline geometryText がある)ことを確認する。
    const sent = JSON.parse(calls[0] ?? "{}") as {
      readonly parts: readonly { readonly geometryText?: string }[];
    };
    expect(sent.parts.length).toBeGreaterThan(0);
    expect(sent.parts.every((part) => typeof part.geometryText === "string" && part.geometryText.length > 0)).toBe(true);
  });

  it("fails with exit 1 when Seamlint reports an error", async () => {
    // 守る仕様: Seamlint が error を返したら exit 1 で、report.status も error になる。
    const seamlintReport = {
      status: "error" as const,
      target: "geometry-request",
      diagnostics: [
        { severity: "error" as const, code: "geometry.seam_length_mismatch", target: "body.armhole/sleeve.armhole", message: "too different" }
      ],
      reports: [
        {
          status: "error" as const,
          target: "body.armhole/sleeve.armhole",
          lengthMm: 460,
          diagnostics: [
            { severity: "error" as const, code: "geometry.seam_length_mismatch", target: "body.armhole/sleeve.armhole", message: "too different" }
          ]
        }
      ]
    };
    const { runner } = fakeRunner({ ok: true, report: seamlintReport, exitCode: 1 });
    const out = collect();

    const exitCode = await runSeamlintCheckCommand([join(fixturesRoot, "valid-blouse"), "--format", "json"], {
      cwd: fixturesRoot,
      stdout: out.io.stdout,
      stderr: out.io.stderr,
      runner
    });

    const report = JSON.parse(out.stdout.join("")) as { readonly status: string };
    expect(exitCode).toBe(1);
    expect(report.status).toBe("error");
  });

  it("degrades to an error report when the Seamlint executable is unavailable", async () => {
    // 守る仕様: Seamlint 実行ファイルが無いときは crash せず、seamlint.kind="unavailable" + SEAMLINT_NOT_FOUND 診断つきの error report に落とす。
    const { runner } = fakeRunner({ ok: false, code: "SEAMLINT_NOT_FOUND", message: "spawn slnt ENOENT" });
    const out = collect();

    const exitCode = await runSeamlintCheckCommand([join(fixturesRoot, "valid-blouse"), "--format", "json"], {
      cwd: fixturesRoot,
      stdout: out.io.stdout,
      stderr: out.io.stderr,
      runner
    });

    const report = JSON.parse(out.stdout.join("")) as {
      readonly status: string;
      readonly seamlint: { readonly kind: string; readonly code?: string };
      readonly diagnostics: readonly { readonly code: string }[];
    };

    expect(exitCode).toBe(1);
    expect(report.status).toBe("error");
    expect(report.seamlint.kind).toBe("unavailable");
    expect(report.seamlint.code).toBe("SEAMLINT_NOT_FOUND");
    expect(report.diagnostics.some((diagnostic) => diagnostic.code === "SEAMLINT_NOT_FOUND")).toBe(true);
  });

  it("classifies a missing subprocess executable as SEAMLINT_NOT_FOUND", async () => {
    // 守る仕様: subprocess runner は実行ファイルが見つからない場合を SEAMLINT_NOT_FOUND に分類する。
    const runner = createSubprocessSeamlintRunner({ bin: "loomit-slnt-missing-executable-test-8d0d1e9c" });
    const result = await runner.run('{"parts":[],"checks":[]}');

    expect(result).toMatchObject({ ok: false, code: "SEAMLINT_NOT_FOUND" });
  });

  it("classifies a resolvable-but-failing executable as bad output, not a missing executable", async () => {
    // 守る仕様: 実行ファイルは解決できるが request を処理できず非0終了するケース(= Seamlint 側の失敗)。
    // node を "check-request" という存在しないスクリプトで呼び、非0終了させる。実体は存在するので
    // SEAMLINT_NOT_FOUND に誤分類せず、SEAMLINT_BAD_OUTPUT として失敗を素通しさせる(P2)。
    const runner = createSubprocessSeamlintRunner({ bin: process.execPath });
    const result = await runner.run('{"parts":[],"checks":[]}');

    expect(result).toMatchObject({ ok: false, code: "SEAMLINT_BAD_OUTPUT" });
  });

  it("skips Seamlint when there are no seams to measure", async () => {
    // 守る仕様: 測る seam が無い project では runner を呼ばず、seamlint.kind="skipped" / checksCount:0 / exit 0 で返す。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-slnt-check-noseams-"));

    try {
      await mkdir(join(tempRoot, "parts/body"), { recursive: true });
      await writeFile(
        join(tempRoot, "loomit.yml"),
        ["schema: loomit.project.v0", "name: no-seams", "garment: blouse", "parts:", "  body: ./parts/body/part.loom"].join("\n"),
        "utf8"
      );
      await writeFile(
        join(tempRoot, "parts/body/part.loom"),
        ["schema: loomit.part.v0", "name: body", "variant: v1", "type: body", "files:", "  preview: body.svg"].join("\n"),
        "utf8"
      );
      await writeFile(
        join(tempRoot, "parts/body/body.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><path id="body-armhole" d="M 0 0 L 100 0" /></svg>\n',
        "utf8"
      );

      const { runner, calls } = neverCalledRunner();
      const out = collect();

      const exitCode = await runSeamlintCheckCommand([tempRoot, "--format", "json"], {
        cwd: fixturesRoot,
        stdout: out.io.stdout,
        stderr: out.io.stderr,
        runner
      });

      const report = JSON.parse(out.stdout.join("")) as {
        readonly checksCount: number;
        readonly seamlint: { readonly kind: string };
      };

      expect(exitCode).toBe(0);
      expect(report.checksCount).toBe(0);
      expect(report.seamlint.kind).toBe("skipped");
      expect(calls).toEqual([]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("quoteForCmd", () => {
  it("always quotes the executable so cmd.exe metacharacters do not split the path", () => {
    // 守る仕様: 実行ファイルパスは常に "" で括り、cmd.exe のメタ文字(& など)でパスが分割されないようにする。
    expect(quoteForCmd("slnt")).toBe('"slnt"');
    expect(quoteForCmd("C:\\bin\\a & b\\slnt.exe")).toBe('"C:\\bin\\a & b\\slnt.exe"');
    expect(quoteForCmd("C:\\Program Files (x86)\\Seamlint\\slnt.cmd")).toBe(
      '"C:\\Program Files (x86)\\Seamlint\\slnt.cmd"'
    );
    expect(quoteForCmd("C:\\weird^path\\slnt.exe")).toBe('"C:\\weird^path\\slnt.exe"');
  });

  it("does not double-quote an already-quoted path", () => {
    // 守る仕様: すでに "" で括られたパスは二重引用しない。
    expect(quoteForCmd('"C:\\bin\\slnt.exe"')).toBe('"C:\\bin\\slnt.exe"');
  });
});

describe("resolveExecutable", () => {
  it("resolves an existing absolute executable", () => {
    // 守る仕様: node 実体は必ず存在する。locale に依らず絶対パスの実行ファイルを解決できる。
    expect(resolveExecutable(process.execPath, process.cwd())).toBeDefined();
  });

  it("resolves a bare command found on PATH", () => {
    // 守る仕様: "node" は PATH 上にある(Windows は PATHEXT を補って解決する)ので、素のコマンド名も解決できる。
    const resolved = resolveExecutable("node", process.cwd());
    expect(resolved).toBeDefined();
  });

  it("resolves a relative executable against the given cwd, not process.cwd()", async () => {
    // 守る仕様: 埋め込み利用で cwd を差し替えたとき、相対 --slnt は process.cwd() ではなく渡した cwd 基準で解決する。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-slnt-relbin-"));
    try {
      await mkdir(join(tempRoot, "tools"), { recursive: true });
      const ext = process.platform === "win32" ? ".cmd" : "";
      const relBin = `tools/slnt${ext}`;
      await writeFile(join(tempRoot, relBin), "echo hi\n", "utf8");

      const resolved = resolveExecutable(relBin, tempRoot);
      expect(resolved).toBe(join(tempRoot, relBin));
      // process.cwd() 基準では見つからない(= cwd が効いている)ことを裏取りする。
      expect(resolveExecutable(relBin, process.cwd())).toBeUndefined();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("returns undefined for a missing executable so callers can report NOT_FOUND", () => {
    // 守る仕様: 実行ファイルが見つからなければ undefined を返し、呼び出し側が NOT_FOUND を報告できるようにする。
    expect(resolveExecutable("loomit-slnt-missing-executable-test-8d0d1e9c", process.cwd())).toBeUndefined();
    // パス区切りを含む指定は PATH 探索せず、実体が無ければ undefined。
    expect(
      resolveExecutable(join(tmpdir(), "loomit-definitely-missing-3f2a1b", "slnt"), process.cwd())
    ).toBeUndefined();
  });
});
