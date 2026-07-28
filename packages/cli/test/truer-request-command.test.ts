import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runTruerRequestCommand } from "../src/commands/truerRequest.js";

// front(146)/back(148) の合印がどちらも #ease を参照する cutSpline に載り、同じ spline 31(端点15/2)を通る。
// 両 detail が #ease を辺に持つので usedBy=[back,front] になる最小の .val。
const SHARED_VAL = `<pattern>
  <increments><increment formula="2" name="#ease"/></increments>
  <draw name="knickers">
    <calculation>
      <point id="15" length="waist_circ + #ease" type="endLine"/>
      <point id="2" length="rise" type="endLine"/>
      <point id="146" length="#ease" spline="31" type="cutSpline"/>
      <point id="148" length="#ease" spline="31" type="cutSpline"/>
      <spline id="31" length1="3" point1="15" point4="2" type="simpleInteractive"/>
    </calculation>
    <modeling>
      <point id="169" idObject="146" type="modeling"/>
      <point id="173" idObject="148" type="modeling"/>
    </modeling>
    <details>
      <detail name="front"><nodes><node idObject="169" passmark="true" type="NodePoint"/></nodes></detail>
      <detail name="back"><nodes><node idObject="173" passmark="true" type="NodePoint"/></nodes></detail>
    </details>
  </draw>
</pattern>`;

// path_ref は「幾何ソース上の住所」で files.piece(= .val の detail 名)とは別フィールド。実データ
// (loomitest3-band-mismatch)と同じく **綴りが違う**形(piece: front / path_ref: FRONT)を既定にして、
// payload の pathRef が piece の写しではなく path_ref 由来であることを固定する。
// pathRef=null は path_ref を宣言しない part（identity だけの connector）。
function partLoom(piece: string, pathRef: string | null): string {
  return [
    "schema: loomit.part.v0",
    `name: ${piece}`,
    "variant: v1",
    "type: body",
    "files:",
    "  source: source.val",
    `  piece: ${piece}`,
    "connectors:",
    "  outseam:",
    "    type: outseam",
    ...(pathRef === null ? [] : [`    path_ref: ${pathRef}`])
  ].join("\n");
}

async function writeProject(
  root: string,
  options: { readonly frontPathRef?: string | null } = {}
): Promise<void> {
  await mkdir(join(root, "parts/front"), { recursive: true });
  await mkdir(join(root, "parts/back"), { recursive: true });

  await writeFile(
    join(root, "loomit.yml"),
    [
      "schema: loomit.project.v0",
      "name: truer-request-fixture",
      "garment: knickers",
      "parts:",
      "  front: ./parts/front/part.loom",
      "  back: ./parts/back/part.loom"
    ].join("\n"),
    "utf8"
  );
  // .val は part 相対にしか置けない(schema が ".." を弾く)ので、各 part dir に同じ .val をコピーする(loomitest3 と同形)。
  const frontPathRef = options.frontPathRef === undefined ? "FRONT" : options.frontPathRef;
  await writeFile(join(root, "parts/front/part.loom"), partLoom("front", frontPathRef), "utf8");
  await writeFile(join(root, "parts/back/part.loom"), partLoom("back", "BACK"), "utf8");
  await writeFile(join(root, "parts/front/source.val"), SHARED_VAL, "utf8");
  await writeFile(join(root, "parts/back/source.val"), SHARED_VAL, "utf8");
}

describe("runTruerRequestCommand", () => {
  it("builds a versioned constraint payload with part-level dependsOn and part-granularity usedBy", async () => {
    // 守る仕様: 健全な project で ok の JSON payload を組む。封筒は { status, diagnostics, payload }、payload は版付き
    // (schema=loomit.constraint-payload.v0)・依存は part 単位(parts[].dependsOn)・connectors は join 鍵＋幾何ソース上の
    // 住所(pathRef)・増分は declared union。両 detail が #ease を辺に持つので usedBy=[back,front]。
    // pathRef は connectors.*.path_ref 由来で files.piece の写しではない(fixture は piece:front / path_ref:FRONT と
    // 綴りを変えてある)。大小も畳まない ── Seamlint が要求綴りをそのまま診断に echo するため。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-truer-request-"));

    try {
      await writeProject(tempRoot);

      const stdout: string[] = [];
      const stderr: string[] = [];
      const exitCode = await runTruerRequestCommand([tempRoot, "--format", "json"], {
        cwd: tempRoot,
        stdout: (text) => {
          stdout.push(text);
        },
        stderr: (text) => {
          stderr.push(text);
        }
      });

      const report = JSON.parse(stdout.join("")) as {
        readonly status: string;
        readonly diagnostics: readonly unknown[];
        readonly payload: {
          readonly schema: string;
          readonly params: Record<string, { readonly declared: boolean; readonly usedBy: readonly string[]; readonly value?: string }>;
          readonly parts: readonly { readonly partId: string; readonly dependsOn: readonly unknown[] }[];
          readonly connectors: readonly {
            readonly partId: string;
            readonly connectorId: string;
            readonly pathRef?: string;
          }[];
        };
      };

      expect(exitCode).toBe(0);
      expect(report.status).toBe("ok");
      expect(report.diagnostics).toEqual([]);
      expect(report.payload.schema).toBe("loomit.constraint-payload.v0");
      expect(report.payload.parts.map((part) => part.partId).sort()).toEqual(["back", "front"]);
      expect(report.payload.connectors).toEqual(
        expect.arrayContaining([
          { partId: "front", connectorId: "outseam", pathRef: "FRONT" },
          { partId: "back", connectorId: "outseam", pathRef: "BACK" }
        ])
      );
      expect(report.payload.params["#ease"]).toEqual({
        declared: true,
        value: "2",
        usedBy: ["back", "front"]
      });
      expect(stderr).toEqual([]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("omits pathRef for a connector that declares no path_ref", async () => {
    // 守る仕様(must-not-fire): path_ref を宣言していない connector は payload でも pathRef を持たない。
    // files.piece から住所を発明しない(piece は .val の detail 名であって幾何ソース上の住所ではない)。
    // 消費側はこれで「住所が無い」と「住所が一致しない」を区別できる。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-truer-request-no-path-ref-"));

    try {
      await writeProject(tempRoot, { frontPathRef: null });

      const stdout: string[] = [];
      const exitCode = await runTruerRequestCommand([tempRoot, "--format", "json"], {
        cwd: tempRoot,
        stdout: (text) => {
          stdout.push(text);
        },
        stderr: () => {}
      });

      const report = JSON.parse(stdout.join("")) as {
        readonly payload: {
          readonly connectors: readonly {
            readonly partId: string;
            readonly connectorId: string;
            readonly pathRef?: string;
          }[];
        };
      };

      expect(exitCode).toBe(0);
      expect(report.payload.connectors).toEqual(
        expect.arrayContaining([
          { partId: "front", connectorId: "outseam" },
          { partId: "back", connectorId: "outseam", pathRef: "BACK" }
        ])
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("exits non-zero with an error status when the project cannot be loaded", async () => {
    // 守る仕様: project が読めない(loomit.yml 無し)ときは黙って空 ok にせず、error status + 非ゼロ終了で返す。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-truer-request-empty-"));

    try {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const exitCode = await runTruerRequestCommand([tempRoot, "--format", "json"], {
        cwd: tempRoot,
        stdout: (text) => {
          stdout.push(text);
        },
        stderr: (text) => {
          stderr.push(text);
        }
      });

      const report = JSON.parse(stdout.join("")) as { readonly status: string };

      expect(exitCode).toBe(1);
      expect(report.status).toBe("error");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects an unknown --format value", async () => {
    // 守る仕様: usage error(未知の --format)は stderr + exit 2 で返す(黙って既定に倒さない)。
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runTruerRequestCommand(["--format", "yaml"], {
      cwd: tmpdir(),
      stdout: (text) => {
        stdout.push(text);
      },
      stderr: (text) => {
        stderr.push(text);
      }
    });

    expect(exitCode).toBe(2);
    expect(stderr.join("")).toContain("Expected --format");
  });
});
