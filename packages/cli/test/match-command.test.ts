import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runMatchCommand } from "../src/commands/match.js";
import type { SeamlintRunResult, SeamlintRunner } from "../src/commands/seamlintCheck.js";
import type { TruerRunResult, TruerRunner } from "../src/commands/truerPropose.js";

// 最小の DXF テキスト。materialize は本文を inline するだけ・fake seamlint は canned report を返すので、
// 内容は問わない(format は .dxf 拡張子から dxf になる)。
const DXF = "0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n";

function fakeTruerRunner(result: TruerRunResult): { runner: TruerRunner; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    runner: {
      run: async (args: readonly string[]): Promise<TruerRunResult> => {
        calls.push([...args]);
        return result;
      }
    }
  };
}

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

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><path id="edge" d="M 0 0 L 100 0" /></svg>\n';

async function writeTempProject(
  specs: readonly {
    readonly role: string;
    readonly partLoom: string;
    readonly files?: Readonly<Record<string, string>>;
  }[]
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "loomit-match-"));
  const partsYaml = specs.map((spec) => `  ${spec.role}: ./parts/${spec.role}/part.loom`).join("\n");
  await writeFile(
    join(root, "loomit.yml"),
    `schema: loomit.project.v0\nname: match-test\ngarment: test\nparts:\n${partsYaml}\n`,
    "utf8"
  );
  for (const spec of specs) {
    await mkdir(join(root, "parts", spec.role), { recursive: true });
    await writeFile(join(root, "parts", spec.role, "part.loom"), spec.partLoom, "utf8");
    for (const [name, content] of Object.entries(spec.files ?? {})) {
      await writeFile(join(root, "parts", spec.role, name), content, "utf8");
    }
  }
  return root;
}

describe("runMatchCommand", () => {
  it("measures only the seam between the two named parts and reports a passing run", async () => {
    // 守る仕様: loom match <a> <b> は2パーツを繋ぐ縫い目だけを Seamlint に渡し、成功実行を pair 単位で報告する。
    const seamlintReport = {
      status: "ok" as const,
      target: "geometry-request",
      diagnostics: [],
      reports: [
        { status: "ok" as const, target: "body.armhole/sleeve.armhole", lengthMm: 469, diagnostics: [] }
      ]
    };
    const { runner, calls } = fakeRunner({ ok: true, report: seamlintReport, exitCode: 0 });
    const out = collect();

    const exitCode = await runMatchCommand(["body", "sleeve", "--format", "json"], {
      cwd: join(fixturesRoot, "valid-blouse"),
      stdout: out.io.stdout,
      stderr: out.io.stderr,
      runner
    });

    const report = JSON.parse(out.stdout.join("")) as {
      readonly status: string;
      readonly roleA: string;
      readonly roleB: string;
      readonly seamCount: number;
      readonly seamlint: { readonly kind: string; readonly report?: { readonly status: string } };
    };

    expect(exitCode).toBe(0);
    expect(report.status).toBe("ok");
    expect(report.roleA).toBe("body");
    expect(report.roleB).toBe("sleeve");
    expect(report.seamCount).toBe(1);
    expect(report.seamlint.kind).toBe("ran");
    expect(report.seamlint.report?.status).toBe("ok");
    expect(out.stderr).toEqual([]);

    // 渡した request は pair に閉じている(body と sleeve だけ・self-contained な geometryText つき)。
    const sent = JSON.parse(calls[0] ?? "{}") as {
      readonly parts: readonly { readonly partId: string; readonly geometryText?: string }[];
    };
    expect(sent.parts.map((part) => part.partId).sort()).toEqual(["body", "sleeve"]);
    expect(sent.parts.every((part) => typeof part.geometryText === "string" && part.geometryText.length > 0)).toBe(true);
  });

  it("fails with MATCH_ROLE_NOT_FOUND without calling Seamlint when a part is unknown", async () => {
    // 守る仕様: 登録されていない role を指すと、Seamlint を呼ばず MATCH_ROLE_NOT_FOUND / exit 1 で返す。
    const { runner, calls } = fakeRunner({ ok: false, code: "SHOULD_NOT_RUN", message: "must not run" });
    const out = collect();

    const exitCode = await runMatchCommand(["body", "collar", "--format", "json"], {
      cwd: join(fixturesRoot, "valid-blouse"),
      stdout: out.io.stdout,
      stderr: out.io.stderr,
      runner
    });

    const report = JSON.parse(out.stdout.join("")) as {
      readonly status: string;
      readonly diagnostics: readonly { readonly code: string }[];
    };

    expect(exitCode).toBe(1);
    expect(report.status).toBe("error");
    expect(report.diagnostics.some((diagnostic) => diagnostic.code === "MATCH_ROLE_NOT_FOUND")).toBe(true);
    expect(calls).toEqual([]);
  });

  it("rejects matching a part to itself without calling Seamlint", async () => {
    // 守る仕様: 同じ role 同士の match は MATCH_SAME_ROLE / exit 1 で弾き、Seamlint を呼ばない(縫い目は異なる2パーツ)。
    const { runner, calls } = fakeRunner({ ok: false, code: "SHOULD_NOT_RUN", message: "must not run" });
    const out = collect();

    const exitCode = await runMatchCommand(["body", "body", "--format", "json"], {
      cwd: join(fixturesRoot, "valid-blouse"),
      stdout: out.io.stdout,
      stderr: out.io.stderr,
      runner
    });

    const report = JSON.parse(out.stdout.join("")) as {
      readonly diagnostics: readonly { readonly code: string }[];
    };

    expect(exitCode).toBe(1);
    expect(report.diagnostics.some((diagnostic) => diagnostic.code === "MATCH_SAME_ROLE")).toBe(true);
    expect(calls).toEqual([]);
  });

  it("reports MATCH_NO_SEAM without calling Seamlint when the two parts share no seam", async () => {
    // 守る仕様: 縫い合うと宣言されていない2パーツは MATCH_NO_SEAM / exit 1 で案内し、Seamlint を呼ばない。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-match-noseam-"));

    try {
      await mkdir(join(tempRoot, "parts/front"), { recursive: true });
      await mkdir(join(tempRoot, "parts/back"), { recursive: true });
      await writeFile(
        join(tempRoot, "loomit.yml"),
        [
          "schema: loomit.project.v0",
          "name: no-seam",
          "garment: skirt",
          "parts:",
          "  front: ./parts/front/part.loom",
          "  back: ./parts/back/part.loom"
        ].join("\n"),
        "utf8"
      );
      // どちらも connector を持たない=繋がっていない2パーツ。
      for (const role of ["front", "back"]) {
        await writeFile(
          join(tempRoot, `parts/${role}/part.loom`),
          [
            "schema: loomit.part.v0",
            `name: ${role}`,
            "variant: v1",
            `type: ${role}`,
            "files:",
            `  preview: ${role}.svg`
          ].join("\n"),
          "utf8"
        );
        await writeFile(
          join(tempRoot, `parts/${role}/${role}.svg`),
          '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><path id="edge" d="M 0 0 L 100 0" /></svg>\n',
          "utf8"
        );
      }

      const { runner, calls } = fakeRunner({ ok: false, code: "SHOULD_NOT_RUN", message: "must not run" });
      const out = collect();

      const exitCode = await runMatchCommand(["front", "back", "--format", "json"], {
        cwd: tempRoot,
        stdout: out.io.stdout,
        stderr: out.io.stderr,
        runner
      });

      const report = JSON.parse(out.stdout.join("")) as {
        readonly seamCount: number;
        readonly seamlint: { readonly kind: string };
        readonly diagnostics: readonly { readonly code: string }[];
      };

      expect(exitCode).toBe(1);
      expect(report.seamCount).toBe(0);
      expect(report.seamlint.kind).toBe("skipped");
      expect(report.diagnostics.some((diagnostic) => diagnostic.code === "MATCH_NO_SEAM")).toBe(true);
      expect(calls).toEqual([]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("stays pair-local: unrelated broken joins do not change a healthy pair's result", async () => {
    // 守る仕様: body↔sleeve の seam が健全なら、無関係な壊れた join(x/y/z の bad)は match の exit code にも
    // 診断にも混ざらない(project 全体の readiness/無関係 connector を pair 結果に持ち込まない)。
    const root = await writeTempProject([
      {
        role: "body",
        partLoom:
          "schema: loomit.part.v0\nname: body\nvariant: v1\ntype: body\nfiles:\n  preview: body.svg\nconnectors:\n  armhole:\n    type: armhole\n    path_ref: svg:path#body-armhole\n",
        files: { "body.svg": SVG }
      },
      {
        role: "sleeve",
        partLoom:
          "schema: loomit.part.v0\nname: sleeve\nvariant: v1\ntype: sleeve\nfiles:\n  preview: sleeve.svg\nconnectors:\n  armhole:\n    type: armhole\n    path_ref: svg:path#sleeve-armhole\n",
        files: { "sleeve.svg": SVG }
      },
      { role: "x", partLoom: "schema: loomit.part.v0\nname: x\nvariant: v1\ntype: x\nconnectors:\n  bad:\n    type: bad\n    side: sx\n" },
      { role: "y", partLoom: "schema: loomit.part.v0\nname: y\nvariant: v1\ntype: y\nconnectors:\n  bad:\n    type: bad\n    side: sy\n" },
      { role: "z", partLoom: "schema: loomit.part.v0\nname: z\nvariant: v1\ntype: z\nconnectors:\n  bad:\n    type: bad\n    side: sz\n" }
    ]);

    try {
      const seamlintReport = {
        status: "ok" as const,
        target: "geometry-request",
        diagnostics: [],
        reports: [{ status: "ok" as const, target: "body.armhole/sleeve.armhole", lengthMm: 100, diagnostics: [] }]
      };
      const { runner, calls } = fakeRunner({ ok: true, report: seamlintReport, exitCode: 0 });
      const out = collect();

      const exitCode = await runMatchCommand(["body", "sleeve", "--format", "json"], {
        cwd: root,
        stdout: out.io.stdout,
        stderr: out.io.stderr,
        runner
      });

      const report = JSON.parse(out.stdout.join("")) as {
        readonly status: string;
        readonly seamCount: number;
        readonly diagnostics: readonly { readonly code: string }[];
      };

      expect(exitCode).toBe(0);
      expect(report.status).toBe("ok");
      expect(report.seamCount).toBe(1);
      expect(report.diagnostics).toEqual([]);
      expect(calls.length).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not report MATCH_NO_SEAM when the parts are connected but the seam cannot be measured", async () => {
    // 守る仕様: connector はあるが check を組めない(body の path_ref 欠落)ときは MATCH_NO_SEAM を出さず、
    // 理由(SEAMLINT_CONNECTOR_PATH_REF_MISSING)を示して Seamlint を呼ばない(接続済み pair に loom connect を勧めない)。
    const root = await writeTempProject([
      {
        role: "body",
        partLoom:
          "schema: loomit.part.v0\nname: body\nvariant: v1\ntype: body\nfiles:\n  preview: body.svg\nconnectors:\n  armhole:\n    type: armhole\n",
        files: { "body.svg": SVG }
      },
      {
        role: "sleeve",
        partLoom:
          "schema: loomit.part.v0\nname: sleeve\nvariant: v1\ntype: sleeve\nfiles:\n  preview: sleeve.svg\nconnectors:\n  armhole:\n    type: armhole\n    path_ref: svg:path#sleeve-armhole\n",
        files: { "sleeve.svg": SVG }
      }
    ]);

    try {
      const { runner, calls } = fakeRunner({ ok: false, code: "SHOULD_NOT_RUN", message: "must not run" });
      const out = collect();

      const exitCode = await runMatchCommand(["body", "sleeve", "--format", "json"], {
        cwd: root,
        stdout: out.io.stdout,
        stderr: out.io.stderr,
        runner
      });

      const report = JSON.parse(out.stdout.join("")) as {
        readonly seamCount: number;
        readonly seamlint: { readonly kind: string };
        readonly diagnostics: readonly { readonly code: string }[];
      };

      expect(exitCode).toBe(0);
      expect(report.seamCount).toBe(0);
      expect(report.seamlint.kind).toBe("skipped");
      expect(report.diagnostics.some((diagnostic) => diagnostic.code === "MATCH_NO_SEAM")).toBe(false);
      expect(report.diagnostics.some((diagnostic) => diagnostic.code === "SEAMLINT_CONNECTOR_PATH_REF_MISSING")).toBe(true);
      expect(calls).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("hands the measured report to Truer and reports the written proposal (--reference)", async () => {
    // 守る仕様: --reference <part> は測定後に Truer を spawn し、follower の DXF・reference の BLOCK・出力先(output/match/<a>-<b>.proposal.json)を渡して proposal を書かせ、その場所を報告する。
    const root = await writeTempProject([
      {
        role: "front",
        partLoom:
          "schema: loomit.part.v0\nname: front\nvariant: v1\ntype: front\nfiles:\n  geometry: front.dxf\nconnectors:\n  outseam:\n    type: outseam\n    path_ref: FRONT\n",
        files: { "front.dxf": DXF }
      },
      {
        role: "back",
        partLoom:
          "schema: loomit.part.v0\nname: back\nvariant: v1\ntype: back\nfiles:\n  geometry: back.dxf\nconnectors:\n  outseam:\n    type: outseam\n    path_ref: BACK\n",
        files: { "back.dxf": DXF }
      }
    ]);

    try {
      const seamlintReport = {
        status: "ok" as const,
        target: "geometry-request",
        diagnostics: [],
        reports: [{ status: "ok" as const, target: "front.outseam/back.outseam", lengthMm: 800, diagnostics: [] }]
      };
      const { runner } = fakeRunner({ ok: true, report: seamlintReport, exitCode: 0 });
      const { runner: truer, calls: truerCalls } = fakeTruerRunner({ ok: true, exitCode: 0 });
      const out = collect();

      const exitCode = await runMatchCommand(["front", "back", "--reference", "back", "--format", "json"], {
        cwd: root,
        stdout: out.io.stdout,
        stderr: out.io.stderr,
        runner,
        truerRunner: truer
      });

      const report = JSON.parse(out.stdout.join("")) as {
        readonly reference?: string;
        readonly truer?: { readonly kind: string; readonly proposalPath?: string };
      };

      expect(exitCode).toBe(0);
      expect(report.reference).toBe("back");
      expect(report.truer?.kind).toBe("proposed");
      expect(report.truer?.proposalPath?.replace(/\\/g, "/")).toContain("output/match/front-back.proposal.json");

      // Truer は follower(=reference でない front)の DXF・reference の BLOCK(BACK)・--out を受け取る。
      expect(truerCalls.length).toBe(1);
      const args = truerCalls[0] ?? [];
      expect(args[0]).toBe("propose");
      expect((args[1] ?? "").replace(/\\/g, "/")).toContain("front/front.dxf");
      expect(args[args.indexOf("--reference") + 1]).toBe("BACK");
      expect((args[args.indexOf("--out") + 1] ?? "").replace(/\\/g, "/")).toContain(
        "output/match/front-back.proposal.json"
      );
      // loom は自分が使う slnt を Truer にも転送する(Truer は preview の edge 解決で slnt を内部起動するため)。
      // --slnt 未指定なので既定の "slnt"。
      expect(args[args.indexOf("--slnt") + 1]).toBe("slnt");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects --reference that is not one of the two parts", async () => {
    // 守る仕様: --reference は名指しした2パーツのどちらかでなければ usage エラー(exit 2)で弾く。
    const { runner } = fakeRunner({ ok: false, code: "SHOULD_NOT_RUN", message: "must not run" });
    const out = collect();

    const exitCode = await runMatchCommand(["body", "sleeve", "--reference", "collar"], {
      cwd: join(fixturesRoot, "valid-blouse"),
      stdout: out.io.stdout,
      stderr: out.io.stderr,
      runner
    });

    expect(exitCode).toBe(2);
    expect(out.stderr.join("")).toContain("--reference");
  });

  it("skips Truer with MATCH_REFERENCE_NEEDS_DXF when the follower has no DXF", async () => {
    // 守る仕様: follower(reference でない側)に files.geometry(DXF)が無ければ Truer を呼ばず、MATCH_REFERENCE_NEEDS_DXF で skip する(測定は済んでいる)。
    const seamlintReport = {
      status: "ok" as const,
      target: "geometry-request",
      diagnostics: [],
      reports: [{ status: "ok" as const, target: "body.armhole/sleeve.armhole", lengthMm: 100, diagnostics: [] }]
    };
    const { runner } = fakeRunner({ ok: true, report: seamlintReport, exitCode: 0 });
    const { runner: truer, calls: truerCalls } = fakeTruerRunner({ ok: true, exitCode: 0 });
    const out = collect();

    // valid-blouse は SVG preview のみ(files.geometry 無し)。reference=body → follower=sleeve は DXF が無い。
    const exitCode = await runMatchCommand(["body", "sleeve", "--reference", "body", "--format", "json"], {
      cwd: join(fixturesRoot, "valid-blouse"),
      stdout: out.io.stdout,
      stderr: out.io.stderr,
      runner,
      truerRunner: truer
    });

    const report = JSON.parse(out.stdout.join("")) as {
      readonly truer?: { readonly kind: string };
      readonly diagnostics: readonly { readonly code: string }[];
    };

    expect(exitCode).toBe(0);
    expect(report.truer?.kind).toBe("skipped");
    expect(report.diagnostics.some((diagnostic) => diagnostic.code === "MATCH_REFERENCE_NEEDS_DXF")).toBe(true);
    expect(truerCalls).toEqual([]);
  });
});
