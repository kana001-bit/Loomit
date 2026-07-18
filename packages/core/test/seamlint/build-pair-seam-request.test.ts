import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildPairSeamRequest, loadProject, resolveParts } from "../../src/index.js";
import type { ResolvedProject } from "../../src/index.js";

interface PartFileSpec {
  readonly role: string;
  readonly partLoom: string;
  readonly files?: Readonly<Record<string, string>>;
}

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><path id="edge" d="M 0 0 L 100 0" /></svg>\n';

// preview svg を1枚持つ part を組み立てる(幾何ソースが要る healthy な側用)。
function svgPart(role: string, connectors: string): PartFileSpec {
  return {
    role,
    partLoom: `schema: loomit.part.v0\nname: ${role}\nvariant: v1\ntype: ${role}\nfiles:\n  preview: ${role}.svg\n${connectors}`,
    files: { [`${role}.svg`]: SVG }
  };
}

// files 無しの part(幾何ソースを持たない・pruned される想定の無関係パーツ等)。
function barePart(role: string, connectors: string): PartFileSpec {
  return {
    role,
    partLoom: `schema: loomit.part.v0\nname: ${role}\nvariant: v1\ntype: ${role}\n${connectors}`
  };
}

function armholeConnector(role: string): string {
  return `connectors:\n  armhole:\n    type: armhole\n    path_ref: svg:path#${role}-armhole\n`;
}

function sideConnector(id: string, side: string, role: string): string {
  return `connectors:\n  ${id}:\n    type: ${id}\n    side: ${side}\n    path_ref: svg:path#${role}-${id}\n`;
}

async function withResolvedProject(
  specs: readonly PartFileSpec[],
  run: (project: ResolvedProject) => void
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "loomit-pairseam-"));
  try {
    const partsYaml = specs.map((spec) => `  ${spec.role}: ./parts/${spec.role}/part.loom`).join("\n");
    await writeFile(
      join(root, "loomit.yml"),
      `schema: loomit.project.v0\nname: pairseam\ngarment: test\nparts:\n${partsYaml}\n`,
      "utf8"
    );
    for (const spec of specs) {
      await mkdir(join(root, "parts", spec.role), { recursive: true });
      await writeFile(join(root, "parts", spec.role, "part.loom"), spec.partLoom, "utf8");
      for (const [name, content] of Object.entries(spec.files ?? {})) {
        await writeFile(join(root, "parts", spec.role, name), content, "utf8");
      }
    }

    const loaded = await loadProject(root);
    if (!loaded.ok) {
      throw new Error("temp project should load");
    }
    const resolved = await resolveParts(loaded.value);
    if (!resolved.ok) {
      throw new Error("temp project parts should resolve");
    }
    run(resolved.value);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("buildPairSeamRequest", () => {
  it("keeps the result pair-local: unrelated broken joins do not leak into the diagnostics", async () => {
    // 守る仕様: loom match は pair-local。body↔sleeve の seam が健全なら、無関係パーツ(x/y/z)の壊れた
    // connector が project 全体で診断を出しても、この pair の結果には混ざらない(checks も parts も pair だけ)。
    await withResolvedProject(
      [
        svgPart("body", armholeConnector("body")),
        svgPart("sleeve", armholeConnector("sleeve")),
        // x/y/z は同じ id "bad" を3つの異なる side で宣言 = full project なら too-many-sides を出す無関係 join。
        barePart("x", "connectors:\n  bad:\n    type: bad\n    side: sx\n"),
        barePart("y", "connectors:\n  bad:\n    type: bad\n    side: sy\n"),
        barePart("z", "connectors:\n  bad:\n    type: bad\n    side: sz\n")
      ],
      (project) => {
        const pair = buildPairSeamRequest(project, "body", "sleeve");

        expect(pair.linked).toBe(true);
        expect(pair.diagnostics).toEqual([]);
        expect(pair.request.checks.map((check) => check.id)).toEqual([
          "sewn-seam:body.armhole/sleeve.armhole"
        ]);
        expect(pair.request.parts.map((part) => part.partId).sort()).toEqual(["body", "sleeve"]);
      }
    );
  });

  it("reports linked=false only when the two parts share no sewing connector", async () => {
    // 守る仕様: 別々の open connector を持つだけで共有 id が無い2パーツは linked=false(呼び出し側で MATCH_NO_SEAM)。
    await withResolvedProject(
      [
        barePart("front", "connectors:\n  outseam:\n    type: outseam\n"),
        barePart("back", "connectors:\n  hem:\n    type: hem\n")
      ],
      (project) => {
        const pair = buildPairSeamRequest(project, "front", "back");

        expect(pair.linked).toBe(false);
        expect(pair.request.checks).toEqual([]);
      }
    );
  });

  it("reports linked=true even when the shared seam cannot build a check, with the reason in diagnostics", async () => {
    // 守る仕様: connector はあるが check を組めない(body 側 path_ref 欠落)ときは linked=true のまま理由を診断で示す。
    // これで呼び出し側は「未接続(MATCH_NO_SEAM)」ではなく「宣言はあるが測れない」と区別できる。
    await withResolvedProject(
      [
        // body の armhole は path_ref を持たない(手書き)→ SEAMLINT_CONNECTOR_PATH_REF_MISSING。
        svgPart("body", "connectors:\n  armhole:\n    type: armhole\n"),
        svgPart("sleeve", armholeConnector("sleeve"))
      ],
      (project) => {
        const pair = buildPairSeamRequest(project, "body", "sleeve");

        expect(pair.linked).toBe(true);
        expect(pair.request.checks).toEqual([]);
        expect(pair.diagnostics.some((diagnostic) => diagnostic.code === "SEAMLINT_CONNECTOR_PATH_REF_MISSING")).toBe(true);
      }
    );
  });

  it("does not treat band co-neighbours as sewing to each other", async () => {
    // 守る仕様: band-seam で front と back は同じ neighbour 側=互いには縫わない(各自 band に縫う)ので linked=false。
    // band(waistband)と neighbour(front)は反対側なので linked=true。side 判定で pair を選ぶ。
    await withResolvedProject(
      [
        svgPart("waistband", sideConnector("waist", "band", "waistband")),
        svgPart("front", sideConnector("waist", "neighbour", "front")),
        svgPart("back", sideConnector("waist", "neighbour", "back"))
      ],
      (project) => {
        expect(buildPairSeamRequest(project, "front", "back").linked).toBe(false);
        expect(buildPairSeamRequest(project, "waistband", "front").linked).toBe(true);
      }
    );
  });
});
