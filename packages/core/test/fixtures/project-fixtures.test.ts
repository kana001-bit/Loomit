import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadPartFile, loadProjectFile } from "../../src/index.js";
import type { LoadFileResult, Part, Project } from "../../src/index.js";

const fixturesRoot = dirname(fileURLToPath(import.meta.url));

describe("project fixtures", () => {
  it("loads valid-blouse project and part files", async () => {
    // 守る仕様: valid-blouse fixture は実際の project 形状で project と part を読み込める。
    const projectPath = join(fixturesRoot, "valid-blouse/loomit.yml");
    const project = expectLoaded(await loadProjectFile(projectPath));
    const body = expectLoaded(
      await loadPartFile(resolveProjectPartPath(projectPath, project, "body"))
    );
    const sleeve = expectLoaded(
      await loadPartFile(resolveProjectPartPath(projectPath, project, "sleeve"))
    );

    expect(project.name).toBe("valid-blouse");
    expect(body.type).toBe("body");
    expect(sleeve.type).toBe("sleeve");
    expect(getArmholeLength(body)).toBe(469);
    expect(getArmholeLength(sleeve)).toBe(470);
  });

  it("prepares missing-sleeve to return a file-not-found diagnostic", async () => {
    // 守る仕様: missing-sleeve fixture は参照先 part.loom が存在せず、file-not-found を errno 由来の
    // 具体的な理由(path not found)付き Diagnostic として再現できる。
    const projectPath = join(fixturesRoot, "missing-sleeve/loomit.yml");
    const project = expectLoaded(await loadProjectFile(projectPath));
    const missingPartPath = resolveProjectPartPath(projectPath, project, "sleeve");
    const result = await loadPartFile(missingPartPath);

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: "error",
          code: "FILE_READ_FAILED",
          message:
            "ファイルを読み込めませんでした。 / Could not read the file. (パスが見つかりません / path not found)",
          target: missingPartPath,
          suggestion: ["パスが正しいか確認してください。 / Check that the path is correct."]
        }
      ]
    });
  });

  it("prepares length-mismatch for connector compatibility rule tests", async () => {
    // 守る仕様: length-mismatch fixture は body と sleeve の仕上がり線寸法が tolerance を超えてずれている。
    const projectPath = join(fixturesRoot, "length-mismatch/loomit.yml");
    const project = expectLoaded(await loadProjectFile(projectPath));
    const body = expectLoaded(
      await loadPartFile(resolveProjectPartPath(projectPath, project, "body"))
    );
    const sleeve = expectLoaded(
      await loadPartFile(resolveProjectPartPath(projectPath, project, "sleeve"))
    );

    const bodyLength = getArmholeLength(body);
    const sleeveLength = getArmholeLength(sleeve);

    expect(Math.abs(bodyLength - sleeveLength)).toBeGreaterThan(3);
  });
});

function expectLoaded<T>(result: LoadFileResult<T>): T {
  if (!result.ok) {
    throw new Error(
      `Expected fixture to load, but got ${result.diagnostics[0]?.code ?? "NO_DIAGNOSTIC"}`
    );
  }

  return result.value;
}

function resolveProjectPartPath(projectPath: string, project: Project, role: string): string {
  const partPath = project.parts[role];

  if (partPath === undefined) {
    throw new Error(`Fixture project is missing part role: ${role}`);
  }

  return join(dirname(projectPath), partPath);
}

function getArmholeLength(part: Part): number {
  const connector = part.connectors?.armhole;

  if (connector === undefined) {
    throw new Error(`Fixture part is missing armhole connector: ${part.name}`);
  }

  // length_mm は optional(未測定を許す)。このフィクスチャは測定済み前提なので、未測定なら明示的に落とす。
  if (connector.length_mm === undefined) {
    throw new Error(`Fixture part armhole connector has no length_mm: ${part.name}`);
  }

  return connector.length_mm;
}
