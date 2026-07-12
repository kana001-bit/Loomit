import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { runConnectCommand } from "../src/commands/connect.js";

// front / back の2パーツを持つ最小プロジェクトを作る。各 part は files.piece を持つ(path_ref の既定元)。
async function makeProject(options?: {
  readonly frontFiles?: string[];
  readonly frontExtra?: string[];
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "loomit-connect-"));

  await writeFile(
    join(root, "loomit.yml"),
    [
      "schema: loomit.project.v0",
      "name: connect-test",
      "garment: knickers",
      "parts:",
      "  front: ./parts/front/part.loom",
      "  back: ./parts/back/part.loom"
    ].join("\n"),
    "utf8"
  );

  await mkdir(join(root, "parts", "front"), { recursive: true });
  await mkdir(join(root, "parts", "back"), { recursive: true });

  const frontFiles = options?.frontFiles ?? ["  source: cycling_knickers.val", "  piece: front"];
  await writeFile(
    join(root, "parts", "front", "part.loom"),
    [
      "schema: loomit.part.v0",
      "name: front",
      "variant: v1",
      "type: body",
      "files:",
      ...frontFiles,
      ...(options?.frontExtra ?? [])
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    join(root, "parts", "back", "part.loom"),
    [
      "schema: loomit.part.v0",
      "name: back",
      "variant: v1",
      "type: body",
      "files:",
      "  source: cycling_knickers.val",
      "  piece: back"
    ].join("\n"),
    "utf8"
  );

  return root;
}

describe("loom connect", () => {
  it("writes a paired connector into both parts with defaults", async () => {
    const root = await makeProject();
    const out: string[] = [];
    const err: string[] = [];

    try {
      const code = await runConnectCommand(["front", "back", "--as", "outseam", "--notches", "2"], {
        cwd: root,
        stdout: (text) => out.push(text),
        stderr: (text) => err.push(text)
      });

      expect(err.join("")).toBe("");
      expect(code).toBe(0);

      // 両 part.loom に同じ id の connector が対で入る(= check がペアにする)。
      const front = await readFile(join(root, "parts/front/part.loom"), "utf8");
      const back = await readFile(join(root, "parts/back/part.loom"), "utf8");

      // type は既定で id、path_ref は既定で files.piece、notch_count は --notches。
      expect(front).toContain("outseam:");
      expect(front).toContain("type: outseam");
      expect(front).toContain("path_ref: front");
      expect(front).toContain("notch_count: 2");
      expect(back).toContain("path_ref: back");
      expect(back).toContain("notch_count: 2");

      expect(out.join("")).toContain('Connected "front" ↔ "back" as "outseam"');
      expect(out.join("")).toContain("Next: loom slnt check");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("honors --type and explicit --path-ref-a/--path-ref-b", async () => {
    const root = await makeProject();
    const out: string[] = [];
    const err: string[] = [];

    try {
      const code = await runConnectCommand(
        [
          "front",
          "back",
          "--as",
          "seam1",
          "--type",
          "side",
          "--path-ref-a",
          "FRONT",
          "--path-ref-b",
          "BACK"
        ],
        { cwd: root, stdout: (text) => out.push(text), stderr: (text) => err.push(text) }
      );

      expect(err.join("")).toBe("");
      expect(code).toBe(0);

      const front = await readFile(join(root, "parts/front/part.loom"), "utf8");
      const back = await readFile(join(root, "parts/back/part.loom"), "utf8");
      expect(front).toContain("seam1:");
      expect(front).toContain("type: side");
      expect(front).toContain("path_ref: FRONT");
      expect(front).not.toContain("notch_count");
      expect(back).toContain("path_ref: BACK");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("notes when a part has no files.geometry so slnt check can't measure yet", async () => {
    const root = await makeProject();
    const out: string[] = [];

    try {
      const code = await runConnectCommand(["front", "back", "--as", "outseam"], {
        cwd: root,
        stdout: (text) => out.push(text),
        stderr: () => {}
      });

      expect(code).toBe(0);
      // path_ref は files.piece から採れるが geometry ソースは無いので、測れない旨を案内する。
      expect(out.join("")).toContain("has no files.geometry or files.preview yet");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when a role is not registered and writes nothing", async () => {
    const root = await makeProject();
    const out: string[] = [];
    const err: string[] = [];

    try {
      const code = await runConnectCommand(["front", "sleeve", "--as", "armhole"], {
        cwd: root,
        stdout: (text) => out.push(text),
        stderr: (text) => err.push(text)
      });

      expect(code).toBe(1);
      expect(err.join("")).toContain("CONNECT_ROLE_NOT_FOUND");
      // front には何も書かれない(部分適用なし)。
      expect(await readFile(join(root, "parts/front/part.loom"), "utf8")).not.toContain(
        "connectors"
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects connecting a part to itself", async () => {
    const root = await makeProject();
    const err: string[] = [];

    try {
      const code = await runConnectCommand(["front", "front", "--as", "x"], {
        cwd: root,
        stdout: () => {},
        stderr: (text) => err.push(text)
      });

      expect(code).toBe(1);
      expect(err.join("")).toContain("CONNECT_SAME_ROLE");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails without a partial write when one part already declares the id", async () => {
    // front に既に outseam があるプロジェクト。connect は書き込み前に両側を検証するので、back も書かれない。
    const root = await makeProject({
      frontExtra: ["connectors:", "  outseam:", "    type: outseam"]
    });
    const err: string[] = [];

    try {
      const code = await runConnectCommand(["front", "back", "--as", "outseam"], {
        cwd: root,
        stdout: () => {},
        stderr: (text) => err.push(text)
      });

      expect(code).toBe(1);
      expect(err.join("")).toContain("CONNECT_ID_ALREADY_DECLARED");
      // back には outseam が書かれない(部分適用なし)。
      expect(await readFile(join(root, "parts/back/part.loom"), "utf8")).not.toContain("outseam");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a connector id that Seamlint would drop and writes nothing", async () => {
    // ":" "." "/" "__" を含む id は書けても loom slnt check で Seamlint が測定対象から外す。
    // authoring 時に弾き、黙って測れない connector を作らせない。
    for (const badId of ["sleeve.armhole", "a/b", "a__b", ".."]) {
      const root = await makeProject();
      const err: string[] = [];

      try {
        const code = await runConnectCommand(["front", "back", "--as", badId], {
          cwd: root,
          stdout: () => {},
          stderr: (text) => err.push(text)
        });

        expect(code).toBe(1);
        expect(err.join("")).toContain("CONNECT_ID_INVALID");
        // どちらの part.loom にも書かない。
        expect(await readFile(join(root, "parts/front/part.loom"), "utf8")).not.toContain(
          "connectors"
        );
        expect(await readFile(join(root, "parts/back/part.loom"), "utf8")).not.toContain(
          "connectors"
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  it("returns a usage error when --as is missing", async () => {
    const root = await makeProject();
    const err: string[] = [];

    try {
      const code = await runConnectCommand(["front", "back"], {
        cwd: root,
        stdout: () => {},
        stderr: (text) => err.push(text)
      });

      expect(code).toBe(2);
      expect(err.join("")).toContain("--as");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
