import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { collectProjectReadinessDiagnostics, loadProject, resolveParts } from "../../src/index.js";

async function resolve(projectRoot: string) {
  const loaded = await loadProject(projectRoot);

  if (!loaded.ok) {
    throw new Error("Expected project to load.");
  }

  const resolved = await resolveParts(loaded.value);

  if (!resolved.ok) {
    throw new Error("Expected project parts to resolve.");
  }

  return resolved.value;
}

async function writeProject(projectRoot: string, partsBlock: string): Promise<void> {
  await writeFile(
    join(projectRoot, "loomit.yml"),
    ["schema: loomit.project.v0", "name: readiness-blouse", "garment: blouse", partsBlock].join(
      "\n"
    ),
    "utf8"
  );
}

async function writeBodyPart(projectRoot: string): Promise<void> {
  await mkdir(join(projectRoot, "parts/body"), { recursive: true });
  await writeFile(
    join(projectRoot, "parts/body/part.loom"),
    [
      "schema: loomit.part.v0",
      "name: body",
      "variant: v1",
      "type: body",
      "files:",
      "  source: body.val"
    ].join("\n"),
    "utf8"
  );
  await writeFile(join(projectRoot, "parts/body/body.val"), "body source\n", "utf8");
}

describe("collectProjectReadinessDiagnostics", () => {
  it("errors when the project has no parts at all", async () => {
    // 守る仕様: parts が空の project は PROJECT_HAS_NO_PARTS を error で出す。
    const projectRoot = await mkdtemp(join(tmpdir(), "loomit-readiness-empty-"));

    try {
      await writeProject(projectRoot, "parts: {}");

      const diagnostics = await collectProjectReadinessDiagnostics(await resolve(projectRoot));

      expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["PROJECT_HAS_NO_PARTS"]);
      expect(diagnostics[0]?.severity).toBe("error");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("warns about a .val under parts/ that no part references", async () => {
    // 守る仕様: どの part も参照しない parts/ 下の .val は UNREGISTERED_VAL_SOURCE を warning で出し、loom add を促す。
    const projectRoot = await mkdtemp(join(tmpdir(), "loomit-readiness-stray-"));

    try {
      await writeProject(projectRoot, "parts:\n  body: ./parts/body/part.loom");
      await writeBodyPart(projectRoot);
      // 登録されていない .val。
      await writeFile(join(projectRoot, "parts/leftover.val"), "stray\n", "utf8");

      const diagnostics = await collectProjectReadinessDiagnostics(await resolve(projectRoot));

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.code).toBe("UNREGISTERED_VAL_SOURCE");
      expect(diagnostics[0]?.severity).toBe("warning");
      expect(diagnostics[0]?.suggestion?.[0]).toContain("loom add parts/leftover.val");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("suggests deleting a stray .val that duplicates an already-registered part", async () => {
    // 守る仕様: 登録済み part と同一内容の残骸 .val は、loom add ではなく登録済み source を指した削除を促す。
    const projectRoot = await mkdtemp(join(tmpdir(), "loomit-readiness-dup-"));

    try {
      await writeProject(projectRoot, "parts:\n  body: ./parts/body/part.loom");
      await writeBodyPart(projectRoot);
      // 登録済み parts/body/body.val と同一内容の残骸を parts/ 直下に置く(= コピーの取り残し)。
      await writeFile(join(projectRoot, "parts/body.val"), "body source\n", "utf8");

      const diagnostics = await collectProjectReadinessDiagnostics(await resolve(projectRoot));

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.code).toBe("UNREGISTERED_VAL_SOURCE");

      // 複製なので loom add ではなく「登録済み source を指して削除を促す」に切り替わる。
      const suggestion = diagnostics[0]?.suggestion?.[0] ?? "";
      expect(suggestion).toContain("delete");
      expect(suggestion).toContain("parts/body/body.val");
      expect(suggestion).not.toContain("loom add");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("is silent when every .val under parts/ is registered", async () => {
    // 守る仕様: parts/ 下の .val が全て登録済みなら診断を出さない。
    const projectRoot = await mkdtemp(join(tmpdir(), "loomit-readiness-ok-"));

    try {
      await writeProject(projectRoot, "parts:\n  body: ./parts/body/part.loom");
      await writeBodyPart(projectRoot);

      const diagnostics = await collectProjectReadinessDiagnostics(await resolve(projectRoot));

      expect(diagnostics).toEqual([]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
