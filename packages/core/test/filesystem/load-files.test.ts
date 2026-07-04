import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadPartFile, loadProjectFile } from "../../src/index.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/load-files");

describe("YAML file loading", () => {
  it("loads a valid project YAML file", async () => {
    // 守る仕様: loomit.yml は read -> parse YAML -> validate schema を通って Project になる。
    const result = await loadProjectFile(join(fixturesRoot, "valid-project/loomit.yml"));

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.name : "").toBe("my-blouse-001");
  });

  it("loads a valid part YAML file", async () => {
    // 守る仕様: part.loom は read -> parse YAML -> validate schema を通って Part になる。
    const result = await loadPartFile(join(fixturesRoot, "valid-part/part.loom"));

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.variant : "").toBe("v3");
  });

  it("loads a valid part YAML file with darts", async () => {
    // 守る仕様: part.loom の darts は schema validation 後も editing feature として保持される。
    const result = await loadPartFile(join(fixturesRoot, "valid-part-with-darts/part.loom"));

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.darts?.waist_front.width_mm : 0).toBe(30);
  });

  it("does not read source.val or project darts when loading a part file", async () => {
    // 守る仕様: loadPartFile は read -> parse -> validate だけの純粋 loader で、source.val を読まない。
    //           darts 射影は darts を消費する経路(loadProjectedPart / diff)の責務。
    const result = await loadPartFile(join(fixturesRoot, "valid-part-projected-darts/part.loom"));

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.darts : {}).toBeUndefined();
    expect(result.diagnostics).toEqual([]);
  });

  it("returns a diagnostic for project YAML parse errors", async () => {
    // 守る仕様: YAML の構文エラーは例外や生エラーではなく Diagnostic に変換する。
    const result = await loadProjectFile(join(fixturesRoot, "invalid-project-yaml/loomit.yml"));

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: "error",
          code: "PROJECT_YAML_INVALID",
          message: "YAML の形式が正しくありません。 / The YAML syntax is invalid.",
          target: join(fixturesRoot, "invalid-project-yaml/loomit.yml"),
          suggestion: [
            "インデント、コロン、括弧の対応を確認してください。 / Check indentation, colons, and matching brackets."
          ]
        }
      ]
    });
  });

  it("returns a diagnostic for project schema validation errors", async () => {
    // 守る仕様: project schema validation の失敗は Zod の生エラーではなく PROJECT_SCHEMA_INVALID になる。
    const result = await loadProjectFile(join(fixturesRoot, "invalid-project-schema/loomit.yml"));

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.diagnostics).toEqual([
      {
        severity: "error",
        code: "PROJECT_SCHEMA_INVALID",
        message:
          "プロジェクトファイルの形式が schema と一致しません。 / The project file does not match the schema.",
        target: join(fixturesRoot, "invalid-project-schema/loomit.yml"),
        suggestion: ["問題の場所: unexpected / Problem path: unexpected"]
      }
    ]);
  });

  it("returns a diagnostic for old part requires shapes", async () => {
    // 守る仕様: requires: \">=4\" の旧形式は schema validation で拒否し、Diagnostic に変換する。
    const result = await loadPartFile(join(fixturesRoot, "invalid-part-schema/part.loom"));

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.diagnostics).toEqual([
      {
        severity: "error",
        code: "PART_SCHEMA_INVALID",
        message:
          "パーツファイルの形式が schema と一致しません。 / The part file does not match the schema.",
        target: join(fixturesRoot, "invalid-part-schema/part.loom"),
        suggestion: ["問題の場所: requires.body.armhole / Problem path: requires.body.armhole"]
      }
    ]);
  });
});
