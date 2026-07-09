import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Readable, Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";
import { createReadlinePrompter } from "../src/prompter.js";
import type { Prompter } from "../src/prompter.js";

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixturesRoot = join(workspaceRoot, "packages/core/test/fixtures");

describe("runCli", () => {
  it("prints main help", async () => {
    const output = createOutputCollector();
    const exitCode = await runCli(["node", "loom", "--help"], {
      cwd: workspaceRoot,
      io: output.io
    });

    expect(exitCode).toBe(0);
    expect(output.stdout.join("")).toContain("Usage: loom <command>");
    expect(output.stderr).toEqual([]);
  });

  it("runs check with text output for a valid project", async () => {
    const output = createOutputCollector();
    const exitCode = await runCli(
      ["node", "loom", "check", join(fixturesRoot, "valid-blouse")],
      {
        cwd: workspaceRoot,
        io: output.io
      }
    );

    expect(exitCode).toBe(0);
    expect(output.stdout.join("")).toContain("Loomit check: ok");
    expect(output.stdout.join("")).toContain("[ok] connector-length body.armhole -> sleeve.armhole");
    expect(output.stderr).toEqual([]);
  });

  it("runs check with JSON output for an invalid project", async () => {
    const output = createOutputCollector();
    const exitCode = await runCli(
      [
        "node",
        "loom",
        "check",
        join(fixturesRoot, "length-mismatch"),
        "--format",
        "json"
      ],
      {
        cwd: workspaceRoot,
        io: output.io
      }
    );

    const report = JSON.parse(output.stdout.join("")) as { readonly status: string };

    expect(exitCode).toBe(1);
    expect(report.status).toBe("error");
    expect(output.stdout.join("")).toContain("CONNECTOR_LENGTH_MISMATCH");
    expect(output.stdout.join("")).toContain("REQUIREMENT_RANGE_UNSATISFIED");
    expect(output.stderr).toEqual([]);
  });

  it("runs doctor with text output for an invalid project", async () => {
    const output = createOutputCollector();
    const exitCode = await runCli(
      ["node", "loom", "doctor", join(fixturesRoot, "length-mismatch")],
      {
        cwd: workspaceRoot,
        io: output.io
      }
    );

    const stdout = output.stdout.join("");

    expect(exitCode).toBe(1);
    expect(stdout).toContain("Loomit doctor: error");
    expect(stdout).toContain("Found 3 problems.");
    expect(stdout).toContain(
      "body.armhole is 469mm and sleeve.armhole is 480mm. The difference is 11mm"
    );
    expect(output.stderr).toEqual([]);
  });

  it("runs doctor with JSON output for a valid project", async () => {
    const output = createOutputCollector();
    const exitCode = await runCli(
      ["node", "loom", "doctor", join(fixturesRoot, "valid-blouse"), "--format", "json"],
      {
        cwd: workspaceRoot,
        io: output.io
      }
    );

    const report = JSON.parse(output.stdout.join("")) as {
      readonly status: string;
      readonly summary: string;
      readonly findings: readonly unknown[];
    };

    expect(exitCode).toBe(0);
    expect(report).toEqual({
      status: "ok",
      summary: "No problems found.",
      diagnostics: [],
      findings: []
    });
    expect(output.stderr).toEqual([]);
  });

  it("runs diff with text output for changed dart parameters", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-diff-"));
    const beforePath = join(tempRoot, "before.part.loom");
    const afterPath = join(tempRoot, "after.part.loom");

    try {
      await writeFile(
        beforePath,
        [
          "schema: loomit.part.v0",
          "name: darted-body",
          "variant: front-v1",
          "type: body",
          "darts:",
          "  waist_front:",
          "    apex_ref: val:point#bodice/Apex",
          "    width_mm: 30",
          "    intake_length_mm: 110",
          "    legs:",
          "      left_ref: val:point#bodice/Left",
          "      right_ref: val:point#bodice/Right"
        ].join("\n"),
        "utf8"
      );

      await writeFile(
        afterPath,
        [
          "schema: loomit.part.v0",
          "name: darted-body",
          "variant: front-v2",
          "type: body",
          "darts:",
          "  waist_front:",
          "    apex_ref: val:point#bodice/Apex",
          "    width_mm: 35",
          "    intake_length_mm: 120",
          "    legs:",
          "      left_ref: val:point#bodice/Left",
          "      right_ref: val:point#bodice/RightMoved"
        ].join("\n"),
        "utf8"
      );

      const output = createOutputCollector();
      const exitCode = await runCli(["node", "loom", "diff", beforePath, afterPath], {
        cwd: workspaceRoot,
        io: output.io
      });

      const stdout = output.stdout.join("");

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Loomit diff: changed");
      expect(stdout).toContain("[modified] dart waist_front");
      expect(stdout).toContain("- width_mm: 30 -> 35");
      expect(stdout).toContain("- intake_length_mm: 110 -> 120");
      expect(stdout).toContain("- legs.right_ref: val:point#bodice/Right -> val:point#bodice/RightMoved");
      expect(output.stderr).toEqual([]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("runs diff with JSON output", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-diff-"));
    const beforePath = join(tempRoot, "before.part.loom");
    const afterPath = join(tempRoot, "after.part.loom");

    try {
      await writeFile(
        beforePath,
        [
          "schema: loomit.part.v0",
          "name: darted-body",
          "variant: front-v1",
          "type: body",
          "darts:",
          "  waist_front:",
          "    apex_ref: val:point#bodice/Apex",
          "    width_mm: 30",
          "    legs:",
          "      left_ref: val:point#bodice/Left",
          "      right_ref: val:point#bodice/Right"
        ].join("\n"),
        "utf8"
      );

      await writeFile(
        afterPath,
        [
          "schema: loomit.part.v0",
          "name: darted-body",
          "variant: front-v1",
          "type: body",
          "darts:",
          "  bust_front:",
          "    apex_ref: val:point#bodice/BustApex",
          "    width_formula: bust_dart_width",
          "    legs:",
          "      left_ref: val:point#bodice/BustLeft",
          "      right_ref: val:point#bodice/BustRight"
        ].join("\n"),
        "utf8"
      );

      const output = createOutputCollector();
      const exitCode = await runCli(
        ["node", "loom", "diff", beforePath, afterPath, "--format", "json"],
        {
          cwd: workspaceRoot,
          io: output.io
        }
      );

      const report = JSON.parse(output.stdout.join("")) as {
        readonly status: string;
        readonly changes: readonly { readonly kind: string; readonly id: string }[];
        readonly recheckHints: {
          readonly partRole: {
            readonly from: string;
            readonly to: string;
            readonly changed: boolean;
          };
          readonly connectors: readonly unknown[];
          readonly requirements: readonly string[];
        };
      };

      expect(exitCode).toBe(0);
      expect(report.status).toBe("changed");
      expect(report.changes).toEqual([
        expect.objectContaining({
          kind: "added",
          id: "bust_front"
        }),
        expect.objectContaining({
          kind: "removed",
          id: "waist_front"
        })
      ]);
      expect(report.recheckHints).toEqual({
        partRole: {
          from: "body",
          to: "body",
          changed: false
        },
        connectors: [],
        requirements: []
      });
      expect(output.stderr).toEqual([]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("prints diff help without requiring part paths", async () => {
    // 守る仕様: loom diff --help は位置引数の検証より先にヘルプ表示へ進み、usage error にしない。
    const output = createOutputCollector();
    const exitCode = await runCli(["node", "loom", "diff", "--help"], {
      cwd: workspaceRoot,
      io: output.io
    });

    expect(exitCode).toBe(0);
    expect(output.stdout.join("")).toContain("Usage: loom diff <from-part.loom> <to-part.loom>");
    expect(output.stderr).toEqual([]);
  });

  it("runs diff for the same part role across two projects", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-project-diff-"));
    const fromProject = join(tempRoot, "from-project");
    const toProject = join(tempRoot, "to-project");

    try {
      await mkdir(join(fromProject, "parts/body"), { recursive: true });
      await mkdir(join(toProject, "parts/body"), { recursive: true });
      await mkdir(join(toProject, "notes"), { recursive: true });

      await writeFile(
        join(fromProject, "loomit.yml"),
        [
          "schema: loomit.project.v0",
          "name: from-project",
          "garment: blouse",
          "parts:",
          "  body: ./parts/body/part.loom"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(toProject, "loomit.yml"),
        [
          "schema: loomit.project.v0",
          "name: to-project",
          "garment: blouse",
          "parts:",
          "  body: ./parts/body/part.loom"
        ].join("\n"),
        "utf8"
      );

      await writeFile(
        join(fromProject, "parts/body/part.loom"),
        [
          "schema: loomit.part.v0",
          "name: darted-body",
          "variant: front-v1",
          "type: body",
          "tags:",
          "  - fitted-armhole",
          "  - non-stretch-fabric",
          "darts:",
          "  waist_front:",
          "    apex_ref: val:point#bodice/Apex",
          "    width_mm: 30",
          "    legs:",
          "      left_ref: val:point#bodice/Left",
          "      right_ref: val:point#bodice/Right"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(toProject, "parts/body/part.loom"),
        [
          "schema: loomit.part.v0",
          "name: darted-body",
          "variant: front-v2",
          "type: body",
          "tags:",
          "  - fitted-armhole",
          "  - non-stretch-fabric",
          "darts:",
          "  waist_front:",
          "    apex_ref: val:point#bodice/Apex",
          "    width_mm: 35",
          "    legs:",
          "      left_ref: val:point#bodice/Left",
          "      right_ref: val:point#bodice/Right"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(toProject, "notes/prototype-notes.yml"),
        [
          "schema: loomit.prototype_notes.v0",
          "notes:",
          "  - id: note-2026-06-28-armhole",
          "    date: 2026-06-28",
          "    result: failed",
          "    issue: armhole tight when raising arms",
          "    suggested_change:",
          "      - increase armhole ease",
          "    creates_test_case: arm-raise",
          "    applies_to:",
          "      - fitted-armhole",
          "      - non-stretch-fabric"
        ].join("\n"),
        "utf8"
      );

      const output = createOutputCollector();
      const exitCode = await runCli(
        ["node", "loom", "diff", fromProject, toProject, "--part", "body"],
        {
          cwd: workspaceRoot,
          io: output.io
        }
      );

      expect(exitCode).toBe(0);
      expect(output.stdout.join("")).toContain("Loomit diff: changed");
      expect(output.stdout.join("")).toContain("[modified] dart waist_front");
      expect(output.stdout.join("")).toContain("- width_mm: 30 -> 35");
      expect(output.stdout.join("")).toContain("Related Prototype Notes:");
      expect(output.stdout.join("")).toContain("note-2026-06-28-armhole");
      expect(output.stderr).toEqual([]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("surfaces invalid prototype notes diagnostics in project diff output", async () => {
    // 守る仕様: diff --part は壊れた notes/prototype-notes.yml を黙殺せず、loadPrototypeNotesFile の診断を report に含める。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-project-diff-notes-"));
    const fromProject = join(tempRoot, "from-project");
    const toProject = join(tempRoot, "to-project");

    try {
      await mkdir(join(fromProject, "parts/body"), { recursive: true });
      await mkdir(join(toProject, "parts/body"), { recursive: true });
      await mkdir(join(toProject, "notes"), { recursive: true });

      await writeFile(
        join(fromProject, "loomit.yml"),
        [
          "schema: loomit.project.v0",
          "name: from-project",
          "garment: blouse",
          "parts:",
          "  body: ./parts/body/part.loom"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(toProject, "loomit.yml"),
        [
          "schema: loomit.project.v0",
          "name: to-project",
          "garment: blouse",
          "parts:",
          "  body: ./parts/body/part.loom"
        ].join("\n"),
        "utf8"
      );

      const sharedPart = [
        "schema: loomit.part.v0",
        "name: darted-body",
        "variant: front-v1",
        "type: body",
        "tags:",
        "  - fitted-armhole"
      ].join("\n");

      await writeFile(join(fromProject, "parts/body/part.loom"), sharedPart, "utf8");
      await writeFile(join(toProject, "parts/body/part.loom"), sharedPart, "utf8");
      await writeFile(
        join(toProject, "notes/prototype-notes.yml"),
        [
          "schema: loomit.prototype_notes.v0",
          "notes:",
          "  - id: note-invalid",
          "    date: 2026-06-28",
          "    result: failed",
          "    issue: armhole tight when raising arms",
          "    creates_test_case: arm-raise"
        ].join("\n"),
        "utf8"
      );

      const output = createOutputCollector();
      const exitCode = await runCli(
        ["node", "loom", "diff", fromProject, toProject, "--part", "body", "--format", "json"],
        {
          cwd: workspaceRoot,
          io: output.io
        }
      );

      const report = JSON.parse(output.stdout.join("")) as {
        readonly status: string;
        readonly diagnostics: readonly { readonly code: string; readonly target?: string }[];
      };

      expect(exitCode).toBe(1);
      expect(report.status).toBe("error");
      expect(report.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "PROTOTYPE_NOTES_SCHEMA_INVALID",
          target: join(toProject, "notes/prototype-notes.yml")
        })
      );
      expect(output.stderr).toEqual([]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("errors when a --part project path does not exist instead of climbing to a parent project", async () => {
    // 守る仕様: diff --part の存在しないプロジェクトパスは、親ディレクトリの別プロジェクトへ遡らずエラーにする。
    // タイプミスした宛先が親プロジェクトに化けて「差分なし」と誤判定されるのを防ぐ。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-diff-missing-"));
    const project = join(tempRoot, "project");
    const missingChild = join(project, "missing-child");

    try {
      await mkdir(join(project, "parts/body"), { recursive: true });

      await writeFile(
        join(project, "loomit.yml"),
        [
          "schema: loomit.project.v0",
          "name: project",
          "garment: blouse",
          "parts:",
          "  body: ./parts/body/part.loom"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(project, "parts/body/part.loom"),
        [
          "schema: loomit.part.v0",
          "name: darted-body",
          "variant: front-v1",
          "type: body"
        ].join("\n"),
        "utf8"
      );

      const output = createOutputCollector();
      const exitCode = await runCli(
        ["node", "loom", "diff", project, missingChild, "--part", "body", "--format", "json"],
        {
          cwd: workspaceRoot,
          io: output.io
        }
      );

      const report = JSON.parse(output.stdout.join("")) as {
        readonly status: string;
        readonly diagnostics: readonly { readonly code: string; readonly target?: string }[];
      };

      expect(exitCode).toBe(1);
      expect(report.status).toBe("error");
      expect(report.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "PROJECT_PATH_NOT_FOUND",
          target: missingChild
        })
      );
      expect(output.stderr).toEqual([]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("prints connector and requirement changes in diff output", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-diff-connectors-"));
    const beforePath = join(tempRoot, "before.part.loom");
    const afterPath = join(tempRoot, "after.part.loom");

    try {
      await writeFile(
        beforePath,
        [
          "schema: loomit.part.v0",
          "name: darted-body",
          "variant: front-v1",
          "type: body",
          "connectors:",
          "  armhole:",
          "    type: armhole",
          "    length_mm: 469",
          "    tolerance_mm: 3",
          "requires:",
          "  sleeve.armhole.length_mm:",
          "    min: 466",
          "    max: 472"
        ].join("\n"),
        "utf8"
      );

      await writeFile(
        afterPath,
        [
          "schema: loomit.part.v0",
          "name: darted-body",
          "variant: front-v2",
          "type: body",
          "connectors:",
          "  armhole:",
          "    type: armhole",
          "    length_mm: 472",
          "    tolerance_mm: 5",
          "requires:",
          "  sleeve.armhole.length_mm:",
          "    min: 468",
          "    max: 474"
        ].join("\n"),
        "utf8"
      );

      const output = createOutputCollector();
      const exitCode = await runCli(["node", "loom", "diff", beforePath, afterPath], {
        cwd: workspaceRoot,
        io: output.io
      });

      const stdout = output.stdout.join("");

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Recheck Hints:");
      expect(stdout).toContain("part role: body");
      expect(stdout).toContain("connectors:");
      expect(stdout).toContain("- armhole (length, tolerance)");
      expect(stdout).toContain("requirements:");
      expect(stdout).toContain("- sleeve.armhole.length_mm");
      expect(stdout).toContain("[modified] connector armhole");
      expect(stdout).toContain("- length_mm: 469 -> 472");
      expect(stdout).toContain("- tolerance_mm: 3 -> 5");
      expect(stdout).toContain("[modified] requirement sleeve.armhole.length_mm");
      expect(stdout).toContain("- min: 466 -> 468");
      expect(stdout).toContain("- max: 472 -> 474");
      expect(output.stderr).toEqual([]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("includes recheck hints in diff JSON for connector and requirement changes", async () => {
    // 守る仕様: diff JSON は Seamlint handoff 用に、connector の再確認種別と requirement id を recheckHints として返す。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-diff-connectors-json-"));
    const beforePath = join(tempRoot, "before.part.loom");
    const afterPath = join(tempRoot, "after.part.loom");

    try {
      await writeFile(
        beforePath,
        [
          "schema: loomit.part.v0",
          "name: darted-body",
          "variant: front-v1",
          "type: body",
          "connectors:",
          "  armhole:",
          "    type: armhole",
          "    length_mm: 469",
          "    tolerance_mm: 3",
          "    path_ref: svg:path#body-armhole",
          "requires:",
          "  sleeve.armhole.length_mm:",
          "    min: 466",
          "    max: 472"
        ].join("\n"),
        "utf8"
      );

      await writeFile(
        afterPath,
        [
          "schema: loomit.part.v0",
          "name: darted-body",
          "variant: front-v2",
          "type: body",
          "connectors:",
          "  armhole:",
          "    type: armhole",
          "    length_mm: 472",
          "    tolerance_mm: 5",
          "    path_ref: svg:path#body-armhole-updated",
          "requires:",
          "  sleeve.armhole.length_mm:",
          "    min: 468",
          "    max: 474"
        ].join("\n"),
        "utf8"
      );

      const output = createOutputCollector();
      const exitCode = await runCli(
        ["node", "loom", "diff", beforePath, afterPath, "--format", "json"],
        {
          cwd: workspaceRoot,
          io: output.io
        }
      );

      const report = JSON.parse(output.stdout.join("")) as {
        readonly recheckHints: {
          readonly partRole: {
            readonly from: string;
            readonly to: string;
            readonly changed: boolean;
          };
          readonly connectors: readonly {
            readonly id: string;
            readonly changeKinds: readonly string[];
          }[];
          readonly requirements: readonly string[];
        };
      };

      expect(exitCode).toBe(0);
      expect(report.recheckHints).toEqual({
        partRole: {
          from: "body",
          to: "body",
          changed: false
        },
        connectors: [
          {
            id: "armhole",
            changeKinds: ["length", "tolerance", "path"]
          }
        ],
        requirements: ["sleeve.armhole.length_mm"]
      });
      expect(output.stderr).toEqual([]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("runs fit with text output for a valid project and profile", async () => {
    const output = createOutputCollector();
    const exitCode = await runCli(
      [
        "node",
        "loom",
        "fit",
        join(fixturesRoot, "valid-blouse"),
        "--profile",
        join(fixturesRoot, "profiles/my-size.yml")
      ],
      {
        cwd: workspaceRoot,
        io: output.io
      }
    );

    const stdout = output.stdout.join("");

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Loomit fit: ok");
    expect(stdout).toContain("[ok] bust body=84cm garment=96cm ease=12cm");
    expect(output.stderr).toEqual([]);
  });

  it("requires a profile for fit", async () => {
    const output = createOutputCollector();
    const exitCode = await runCli(["node", "loom", "fit", join(fixturesRoot, "valid-blouse")], {
      cwd: workspaceRoot,
      io: output.io
    });

    expect(exitCode).toBe(2);
    expect(output.stderr.join("")).toContain("Expected --profile <name|path>.");
  });

  it("returns a usage error for unknown commands", async () => {
    const output = createOutputCollector();
    const exitCode = await runCli(["node", "loom", "unknown"], {
      cwd: workspaceRoot,
      io: output.io
    });

    expect(exitCode).toBe(2);
    expect(output.stderr.join("")).toContain("Unknown command: unknown");
  });

  it("guides you to add a part when checking a freshly initialized (empty) project", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-init-"));
    const projectPath = join(tempRoot, "created-blouse");

    try {
      await mkdir(projectPath, { recursive: true });

      const initOutput = createOutputCollector();
      const initExitCode = await runCli(["node", "loom", "init", "--garment", "blouse"], {
        cwd: projectPath,
        io: initOutput.io
      });

      expect(initExitCode).toBe(0);
      const initStdout = initOutput.stdout.join("");
      expect(initStdout).toContain("Created Loomit project:");
      // init 直後に次の一歩を案内する(初見のつまずき対策)。part.loom は手書きさせず loom add へ導く。
      expect(initStdout).toContain("Next steps:");
      expect(initStdout).toContain("loom add");
      expect(initStdout).toContain("loom check");
      expect(initOutput.stderr).toEqual([]);

      // 守る仕様: part が1つも無い project の check は「ok」で誤誘導せず、先に loom add するよう error で促す。
      const checkOutput = createOutputCollector();
      const checkExitCode = await runCli(["node", "loom", "check", projectPath], {
        cwd: workspaceRoot,
        io: checkOutput.io
      });

      expect(checkExitCode).toBe(1);
      expect(checkOutput.stdout.join("")).toContain("Loomit check: error");
      expect(checkOutput.stdout.join("")).toContain("PROJECT_HAS_NO_PARTS");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("blocks build on an empty project and points to loom add", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-build-empty-"));

    try {
      await runCli(["node", "loom", "init"], { cwd: tempRoot, io: createOutputCollector().io });

      const output = createOutputCollector();
      const exitCode = await runCli(["node", "loom", "build", tempRoot], {
        cwd: workspaceRoot,
        io: output.io
      });

      expect(exitCode).toBe(1);
      expect(output.stdout.join("")).toContain("PROJECT_HAS_NO_PARTS");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("warns about an unregistered .val under parts/ without failing check", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-stray-val-"));

    try {
      await runCli(["node", "loom", "init"], { cwd: tempRoot, io: createOutputCollector().io });
      await writeFile(join(tempRoot, "body.val"), "body source\n", "utf8");
      await runCli(["node", "loom", "add", "body.val"], {
        cwd: tempRoot,
        io: createOutputCollector().io,
        prompter: createScriptedPrompter({ texts: ["body", "body", "v1"], confirms: [false] })
      });

      // 登録されていない .val を parts/ 配下に置く。
      await writeFile(join(tempRoot, "parts/leftover.val"), "stray\n", "utf8");

      const output = createOutputCollector();
      const exitCode = await runCli(["node", "loom", "check", tempRoot], {
        cwd: workspaceRoot,
        io: output.io
      });

      // 守る仕様: 未登録 .val は warning(check は失敗させない)で、loom add を促す。
      expect(exitCode).toBe(0);
      expect(output.stdout.join("")).toContain("Loomit check: warning");
      expect(output.stdout.join("")).toContain("UNREGISTERED_VAL_SOURCE");
      expect(output.stdout.join("")).toContain("loom add parts/leftover.val");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("adds a .val as a part via the interactive wizard and can then check it", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-add-"));
    const projectPath = join(tempRoot, "add-blouse");

    try {
      await mkdir(projectPath, { recursive: true });
      await runCli(["node", "loom", "init", "--garment", "blouse"], {
        cwd: projectPath,
        io: createOutputCollector().io
      });
      await writeFile(join(projectPath, "body.val"), "body source\n", "utf8");

      const output = createOutputCollector();
      const exitCode = await runCli(["node", "loom", "add", "body.val"], {
        cwd: projectPath,
        io: output.io,
        // 回答順: name, type(select), variant, [connector追加?], seam type(select), join id, length(空=未測定), [もう1つ?]
        // 新規 join は種類(type)と一意 id を分けて訊く。ここでは type=armhole・id=armhole を与える。
        // length は幾何の測定値で .val 評価が要るため、手入力を強制せず空 Enter(未測定)で先へ進める。
        prompter: createScriptedPrompter({
          texts: ["body", "body", "v1", "armhole", "armhole", ""],
          confirms: [true, false]
        })
      });

      expect(exitCode).toBe(0);
      expect(output.stdout.join("")).toContain('Added part "body"');
      expect(output.stderr).toEqual([]);

      // .val は part ディレクトリへコピーされ、part.loom が生成され、loomit.yml に登録される。
      expect(await readFile(join(projectPath, "parts/body/body.val"), "utf8")).toBe("body source\n");
      const generatedPart = await readFile(join(projectPath, "parts/body/part.loom"), "utf8");
      expect(generatedPart).toContain("schema: loomit.part.v0");
      expect(generatedPart).toContain("type: body");
      expect(generatedPart).toContain("source: body.val");
      // 未測定なので identity(type)だけの connector が生成され、length_mm は載らない。
      expect(generatedPart).toContain("armhole:");
      expect(generatedPart).toContain("type: armhole");
      expect(generatedPart).not.toContain("length_mm:");
      expect(await readFile(join(projectPath, "loomit.yml"), "utf8")).toContain(
        "body: ./parts/body/part.loom"
      );

      // 生成した part を含めて check が走る(= .val を置くだけで検証可能な状態になる)。
      // この時点では armhole を宣言しているのは body だけ=相手待ちの open join なので、
      // connector-pairing ルールが warning を出す(相手パーツを足すまでは正常。error ではないので exit 0)。
      const checkOutput = createOutputCollector();
      const checkExitCode = await runCli(["node", "loom", "check", projectPath], {
        cwd: workspaceRoot,
        io: checkOutput.io
      });

      expect(checkExitCode).toBe(0);
      const checkStdout = checkOutput.stdout.join("");
      expect(checkStdout).toContain("Loomit check: warning");
      expect(checkStdout).toContain("CONNECTOR_JOIN_OPEN");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("scaffolds one part per detected detail piece", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-add-details-"));
    // 守る仕様: garment-aware add の最初の一歩として、.val の detail 一覧を read-only で見せてから対話を始める。

    try {
      await runCli(["node", "loom", "init", "--garment", "blouse"], {
        cwd: tempRoot,
        io: createOutputCollector().io
      });
      await writeFile(
        join(tempRoot, "waist.val"),
        `<?xml version="1.0" encoding="UTF-8"?>
<pattern>
  <draw name="block">
    <details>
      <detail id="102" name="front"></detail>
      <detail id="138" name="center_back"></detail>
      <detail id="224" name="upper_sleeve"></detail>
    </details>
  </draw>
</pattern>`,
        "utf8"
      );

      const output = createOutputCollector();
      const exitCode = await runCli(["node", "loom", "add", "waist.val"], {
        cwd: tempRoot,
        io: output.io,
        prompter: createScriptedPrompter({
          texts: [
            "front",
            "front",
            "body",
            "v1",
            "center_back",
            "center_back",
            "body",
            "v1",
            "upper_sleeve",
            "upper_sleeve",
            "sleeve",
            "v1"
          ],
          confirms: [false, false, false]
        })
      });

      const stdout = output.stdout.join("");

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Detected Valentina details:");
      expect(stdout).toContain("Piece: front (draw: block)");
      expect(stdout).toContain("Piece: center_back (draw: block)");
      expect(stdout).toContain("Piece: upper_sleeve (draw: block)");
      expect(await readFile(join(tempRoot, "loomit.yml"), "utf8")).toContain(
        "front: ./parts/front/part.loom"
      );
      expect(await readFile(join(tempRoot, "loomit.yml"), "utf8")).toContain(
        "center_back: ./parts/center_back/part.loom"
      );
      expect(await readFile(join(tempRoot, "loomit.yml"), "utf8")).toContain(
        "upper_sleeve: ./parts/upper_sleeve/part.loom"
      );
      expect(await readFile(join(tempRoot, "parts/front/part.loom"), "utf8")).toContain(
        "piece: front"
      );
      expect(await readFile(join(tempRoot, "parts/center_back/part.loom"), "utf8")).toContain(
        "piece: center_back"
      );
      expect(await readFile(join(tempRoot, "parts/upper_sleeve/part.loom"), "utf8")).toContain(
        "piece: upper_sleeve"
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("imports every piece and consumes the source only after the last, even from inside parts/", async () => {
    // 守る仕様: 1 .val→N part で元 .val が parts/ 内にあっても、最後のピースまで元を残す。
    // 途中で元を消して後続ピースが PART_ADD_SOURCE_NOT_FOUND で落ち、部分取り込みになるのを防ぐ。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-add-consume-"));

    try {
      await runCli(["node", "loom", "init", "--garment", "blouse"], {
        cwd: tempRoot,
        io: createOutputCollector().io
      });
      await mkdir(join(tempRoot, "parts"), { recursive: true });
      await writeFile(
        join(tempRoot, "parts/foo.val"),
        `<?xml version="1.0" encoding="UTF-8"?>
<pattern>
  <draw name="block">
    <details>
      <detail id="1" name="front"></detail>
      <detail id="2" name="back"></detail>
    </details>
  </draw>
</pattern>`,
        "utf8"
      );

      const output = createOutputCollector();
      const exitCode = await runCli(["node", "loom", "add", "parts/foo.val"], {
        cwd: tempRoot,
        io: output.io,
        prompter: createScriptedPrompter({
          texts: ["front", "front", "body", "v1", "back", "back", "body", "v1"],
          confirms: [false, false]
        })
      });

      expect(exitCode).toBe(0);
      const loomit = await readFile(join(tempRoot, "loomit.yml"), "utf8");
      expect(loomit).toContain("front: ./parts/front/part.loom");
      expect(loomit).toContain("back: ./parts/back/part.loom");
      // v0 = per-part copy: 各ピースは自分の dir に .val コピーを持つ。
      expect(await readFile(join(tempRoot, "parts/front/foo.val"), "utf8")).toContain("<detail");
      expect(await readFile(join(tempRoot, "parts/back/foo.val"), "utf8")).toContain("<detail");
      // 元 .val は全ピース取り込み後に1回だけ消費(削除)される。
      await expect(readFile(join(tempRoot, "parts/foo.val"), "utf8")).rejects.toThrow();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("calls out a draw with zero detail pieces and adds nothing", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-add-zero-details-"));
    // 守る仕様: 0-detail .val も「見つからなかった」で終わらせず、piece が無い draw として案内する。

    try {
      await runCli(["node", "loom", "init", "--garment", "blouse"], {
        cwd: tempRoot,
        io: createOutputCollector().io
      });
      await writeFile(
        join(tempRoot, "blouse.val"),
        `<?xml version="1.0" encoding="UTF-8"?>
<pattern>
  <draw name="blouse">
    <details/>
  </draw>
</pattern>`,
        "utf8"
      );

      const output = createOutputCollector();
      const exitCode = await runCli(["node", "loom", "add", "blouse.val"], {
        cwd: tempRoot,
        io: output.io
      });

      const stdout = output.stdout.join("");

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Detected Valentina details:");
      expect(stdout).toContain("draw: blouse");
      expect(stdout).toContain("pieces: none");
      expect(stdout).toContain('This .val has no <detail> pieces yet');
      expect(stdout).toContain("No detail pieces were added.");
      await expect(readFile(join(tempRoot, "parts/blouse/part.loom"), "utf8")).rejects.toThrow();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("suggests joins already declared by other parts when adding a connector", async () => {
    // 守る仕様: connector は「名前付きの join」で、check は同じ id を宣言し合うかでペアにする。
    // そこで2つ目以降のパーツを add するとき、既に他パーツが宣言している join を宣言元 role 付きで提示し、
    // 選べば相手と id が確実に一致する(seam の形は尋ねない)。最初のパーツには提示する相手が居ないので出さない。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-add-join-"));

    try {
      await runCli(["node", "loom", "init", "--garment", "blouse"], {
        cwd: tempRoot,
        io: createOutputCollector().io
      });
      await writeFile(join(tempRoot, "body.val"), "body source\n", "utf8");
      await writeFile(join(tempRoot, "sleeve.val"), "sleeve source\n", "utf8");

      // 1つ目(body): 既存 join が無いので新しい join を作る(種類 type と一意 id を分けて訊く)。相手一覧は出ないはず。
      // 回答順: name, type(select), variant, [connector追加?], seam type(select), join id, length(空=未測定), [もう1つ?]
      const bodyOut = createOutputCollector();
      const bodyExit = await runCli(["node", "loom", "add", "body.val"], {
        cwd: tempRoot,
        io: bodyOut.io,
        prompter: createScriptedPrompter({
          texts: ["body", "body", "v1", "armhole", "armhole", ""],
          confirms: [true, false]
        })
      });

      expect(bodyExit).toBe(0);
      expect(bodyOut.stdout.join("")).not.toContain("Existing joins");

      // 2つ目(sleeve): body が宣言済みの "armhole" が候補として提示され、選ぶと同じ id の connector になる。
      // 回答順: name, type(select), variant, [connector追加?], join(select=armhole), length(空), [もう1つ?]
      const sleeveOut = createOutputCollector();
      const sleeveExit = await runCli(["node", "loom", "add", "sleeve.val"], {
        cwd: tempRoot,
        io: sleeveOut.io,
        prompter: createScriptedPrompter({
          texts: ["sleeve", "sleeve", "v1", "armhole", ""],
          confirms: [true, false]
        })
      });

      expect(sleeveExit).toBe(0);
      // 既存 join が id・種類[type]・宣言元 role 付きで提示される(shape の taxonomy は出さない)。
      expect(sleeveOut.stdout.join("")).toContain("Existing joins");
      expect(sleeveOut.stdout.join("")).toContain("armhole [armhole] (body)");
      // 選んだ join がそのまま connector id になり、body と同じ id で縫い合わせ相手になる。
      const sleevePart = await readFile(join(tempRoot, "parts/sleeve/part.loom"), "utf8");
      expect(sleevePart).toContain("armhole:");
      expect(sleevePart).toContain("type: armhole");

      // check は同じ id を突き合わせて「縫い合わせ可能」を判定する。
      const checkOut = createOutputCollector();
      const checkExit = await runCli(["node", "loom", "check", tempRoot], {
        cwd: workspaceRoot,
        io: checkOut.io
      });

      expect(checkExit).toBe(0);
      expect(checkOut.stdout.join("")).toContain("connector-length body.armhole -> sleeve.armhole");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not re-offer a join already declared by two parts (avoids many-to-many wiring)", async () => {
    // 守る仕様: check は同じ id を宣言するパーツ同士を総当たりでペアにするため、既に2パーツで閉じた join を
    // 3つ目にも選ばせると多対多に繋がる。そこで候補は「まだ1パーツしか宣言していない open な join」だけに絞り、
    // 閉じた join(body+sleeve の armhole)は3つ目のパーツには提示しない。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-add-closed-join-"));

    try {
      await runCli(["node", "loom", "init", "--garment", "blouse"], {
        cwd: tempRoot,
        io: createOutputCollector().io
      });
      await writeFile(join(tempRoot, "body.val"), "body source\n", "utf8");
      await writeFile(join(tempRoot, "sleeve.val"), "sleeve source\n", "utf8");
      await writeFile(join(tempRoot, "facing.val"), "facing source\n", "utf8");

      // body と sleeve が armhole を宣言し合い、armhole を「閉じた(2パーツ)」join にする。
      // body は新規 join(seam type + join id)、sleeve は body の open armhole を選んで継承する。
      await runCli(["node", "loom", "add", "body.val"], {
        cwd: tempRoot,
        io: createOutputCollector().io,
        prompter: createScriptedPrompter({
          texts: ["body", "body", "v1", "armhole", "armhole", ""],
          confirms: [true, false]
        })
      });
      await runCli(["node", "loom", "add", "sleeve.val"], {
        cwd: tempRoot,
        io: createOutputCollector().io,
        prompter: createScriptedPrompter({
          texts: ["sleeve", "sleeve", "v1", "armhole", ""],
          confirms: [true, false]
        })
      });

      // 3つ目(facing): armhole は閉じているので候補に出ず、既存 join 一覧そのものが提示されない。
      // openJoins が空なので promptJoin は直接「新しい join」を作る(seam type + join id)。
      const facingOut = createOutputCollector();
      const facingExit = await runCli(["node", "loom", "add", "facing.val"], {
        cwd: tempRoot,
        io: facingOut.io,
        prompter: createScriptedPrompter({
          texts: ["facing", "facing", "v1", "neckline", "neckline", ""],
          confirms: [true, false]
        })
      });

      expect(facingExit).toBe(0);
      // 閉じた armhole は縫い合わせ候補として再提示されない(一覧そのものが出ない)。
      // ※ seam type メニューには種類ラベルとしての "armhole" が出るので、join 一覧形式(`id [type]`)で判定する。
      expect(facingOut.stdout.join("")).not.toContain("Existing joins");
      expect(facingOut.stdout.join("")).not.toContain("armhole [");
      // facing は既存 armhole に相乗りせず、新しい join を宣言する。
      const facingPart = await readFile(join(tempRoot, "parts/facing/part.loom"), "utf8");
      expect(facingPart).toContain("neckline:");
      expect(facingPart).not.toContain("armhole:");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("defaults the join prompt to naming a new join, so a blank Enter does not silently reuse an existing join", async () => {
    // 守る仕様: 既存 join があるときの select default は「新しい join を名付ける」に倒す。default を先頭の
    // 既存 join にすると、空 Enter だけで意図せずその相手へ接続されてしまう(prompter.select は空入力で default を返す)。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-add-join-default-"));

    try {
      await runCli(["node", "loom", "init", "--garment", "blouse"], {
        cwd: tempRoot,
        io: createOutputCollector().io
      });
      await writeFile(join(tempRoot, "body.val"), "body source\n", "utf8");
      await writeFile(join(tempRoot, "sleeve.val"), "sleeve source\n", "utf8");

      await runCli(["node", "loom", "add", "body.val"], {
        cwd: tempRoot,
        io: createOutputCollector().io,
        prompter: createScriptedPrompter({
          texts: ["body", "body", "v1", "armhole", "armhole", ""],
          confirms: [true, false]
        })
      });

      // sleeve の join select で空 Enter を押す。回答順: name, type, variant, connector追加?(y),
      // join select(空=default→新しい join), seam type(side), join id(sideseam), length(空), もう1つ?(空=false)。
      const output = createOutputCollector();
      const prompter = createReadlinePrompter(
        Readable.from("sleeve\nsleeve\nv1\ny\n\nside\nsideseam\n\n\n"),
        new Writable({
          write(_chunk, _encoding, callback) {
            callback();
          }
        })
      );

      const exitCode = await runCli(["node", "loom", "add", "sleeve.val"], {
        cwd: tempRoot,
        io: output.io,
        prompter
      });

      expect(exitCode).toBe(0);
      // 空 Enter は default(=新しい join を名付ける)へ倒れ、既存 armhole には黙って繋がらない。
      const sleevePart = await readFile(join(tempRoot, "parts/sleeve/part.loom"), "utf8");
      expect(sleevePart).toContain("sideseam:");
      expect(sleevePart).not.toContain("armhole:");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects the reserved sentinel as a new join name so it stays selectable later", async () => {
    // 守る仕様: 番兵 "(name a new join)" は isSafePathSegment を通ってしまうが、実 join 名としては拒否する。
    // 許すと次回以降その join を選んでも番兵と誤認され、再利用できなくなる。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-add-reserved-"));

    try {
      await runCli(["node", "loom", "init", "--garment", "blouse"], {
        cwd: tempRoot,
        io: createOutputCollector().io
      });
      await writeFile(join(tempRoot, "body.val"), "body source\n", "utf8");

      const output = createOutputCollector();
      // seam type を選んだあと、join id にまず番兵そのものを渡す(拒否される)→ 続けて有効な id "hem" を渡す。
      const exitCode = await runCli(["node", "loom", "add", "body.val"], {
        cwd: tempRoot,
        io: output.io,
        prompter: createScriptedPrompter({
          texts: ["body", "body", "v1", "hem", "(name a new join)", "hem", ""],
          confirms: [true, false]
        })
      });

      expect(exitCode).toBe(0);
      expect(output.stdout.join("")).toContain("is reserved");
      const bodyPart = await readFile(join(tempRoot, "parts/body/part.loom"), "utf8");
      expect(bodyPart).toContain("hem:");
      expect(bodyPart).not.toContain("(name a new join)");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("records the seam type separately from the join id (id != type)", async () => {
    // 守る仕様: 新規 join は種類(type)と一意 id を分けて訊き、connector には両方を別々に書く。
    // id=type だった旧挙動(buildConnectors の type: input.id)を捨て、id≠type を表せることを固定する。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-add-idtype-"));

    try {
      await runCli(["node", "loom", "init", "--garment", "blouse"], {
        cwd: tempRoot,
        io: createOutputCollector().io
      });
      await writeFile(join(tempRoot, "panel.val"), "panel source\n", "utf8");

      // 回答順: name, type(select), variant, connector追加?(y), seam type(side), join id(side_left), length(空), もう1つ?(n)。
      const output = createOutputCollector();
      const exitCode = await runCli(["node", "loom", "add", "panel.val"], {
        cwd: tempRoot,
        io: output.io,
        prompter: createScriptedPrompter({
          texts: ["panel", "body", "v1", "side", "side_left", ""],
          confirms: [true, false]
        })
      });

      expect(exitCode).toBe(0);
      const part = await readFile(join(tempRoot, "parts/body/part.loom"), "utf8");
      // record キーは一意 id、type は種類ラベル。両者は別物として書かれる。
      expect(part).toContain("side_left:");
      expect(part).toContain("type: side");
      expect(part).not.toContain("type: side_left");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("adds a second same-type seam to one part with a distinct default id (not dropped as a dup)", async () => {
    // 守る仕様(回帰): 同じ part に同じ seam type を2本、既定値で足したとき、2本目の既定 id が side_2 になり
    // 両方残る。add ループ中に選んだ id を taken 扱いしないと、2本目も side を提案され最後に duplicate として
    // 黙って捨てられ、「同じ type でも別 id を自然に振れる」が成立しなくなる(その退行を防ぐ)。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-add-samepart-"));

    try {
      await runCli(["node", "loom", "init", "--garment", "blouse"], {
        cwd: tempRoot,
        io: createOutputCollector().io
      });
      await writeFile(join(tempRoot, "panel.val"), "panel source\n", "utf8");

      // すべて既定で進む(空 Enter)。confirm だけ y/空。既定を効かせたいので readline prompter を使う。
      // 順: name, type, variant, add?(y), seam type(既定side), join id(既定side), length,
      //     another?(y), seam type(既定side), join id(既定side_2), length, another?(空=false)。
      const output = createOutputCollector();
      const prompter = createReadlinePrompter(
        Readable.from("\n\n\ny\n\n\n\ny\n\n\n\n\n"),
        new Writable({
          write(_chunk, _encoding, callback) {
            callback();
          }
        })
      );

      const exitCode = await runCli(["node", "loom", "add", "panel.val"], {
        cwd: tempRoot,
        io: output.io,
        prompter
      });

      expect(exitCode).toBe(0);
      // 2本目は捨てられず、別 id(side_2)で残る。どちらも type=side。
      expect(output.stdout.join("")).not.toContain("skipping duplicate");
      const part = await readFile(join(tempRoot, "parts/body/part.loom"), "utf8");
      expect(part).toContain("side:");
      expect(part).toContain("side_2:");
      expect(part).toContain("type: side");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects re-typing an id already added to the same part and re-prompts", async () => {
    // 守る仕様: add ループ中に既に使った id を手入力で再度付けようとしたら弾く(自分自身との衝突なので
    // 「一覧から選べ」ではなく別 id を促す)。scripted で確定的に確認する。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-add-samepart-clash-"));

    try {
      await runCli(["node", "loom", "init", "--garment", "blouse"], {
        cwd: tempRoot,
        io: createOutputCollector().io
      });
      await writeFile(join(tempRoot, "panel.val"), "panel source\n", "utf8");

      // 1本目: seam type=side, id=side。2本目: id に side を打つ(拒否)→ side_left。
      const output = createOutputCollector();
      const exitCode = await runCli(["node", "loom", "add", "panel.val"], {
        cwd: tempRoot,
        io: output.io,
        prompter: createScriptedPrompter({
          texts: ["panel", "body", "v1", "side", "side", "", "side", "side", "side_left", ""],
          confirms: [true, true, false]
        })
      });

      expect(exitCode).toBe(0);
      expect(output.stdout.join("")).toContain("already added to this part");
      const part = await readFile(join(tempRoot, "parts/body/part.loom"), "utf8");
      expect(part).toContain("side:");
      expect(part).toContain("side_left:");
      expect(output.stdout.join("")).not.toContain("skipping duplicate");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("lets two seams of the same type keep distinct ids without over-pairing", async () => {
    // 守る仕様(本 task の核心): 同じ type("side")の縫い目が2本あっても、id を分ければ check は
    // それぞれ2パーツの健全なペアとして扱い、CONNECTOR_JOIN_OVERPAIRED を出さない。id を潰していた
    // 旧挙動なら 3+ パーツが同一 id を宣言して over-pair していたケースを回帰から守る。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-add-sametype-"));

    try {
      await runCli(["node", "loom", "init", "--garment", "blouse"], {
        cwd: tempRoot,
        io: createOutputCollector().io
      });
      await writeFile(join(tempRoot, "front.val"), "front source\n", "utf8");
      await writeFile(join(tempRoot, "side_panel.val"), "side_panel source\n", "utf8");
      await writeFile(join(tempRoot, "back.val"), "back source\n", "utf8");

      // part type は旧経路(1着1val)では role になる。ここでは role を分けたいので type=other→役割名にする
      // (脇パネルの part type と、縫い目の seam type="side" は別軸であることに注意)。
      // front: 新規 join seam type=side id=side_front(open)。
      await runCli(["node", "loom", "add", "front.val"], {
        cwd: tempRoot,
        io: createOutputCollector().io,
        prompter: createScriptedPrompter({
          texts: ["front", "other", "front", "v1", "side", "side_front", ""],
          confirms: [true, false]
        })
      });

      // side_panel: 既存 side_front を選んで閉じ、さらに新規 join seam type=side id=side_back(open)を足す。
      // 1パーツが同じ seam type の縫い目を2本持つ(脇パネルが前後に接ぐ)実データ的な形。
      await runCli(["node", "loom", "add", "side_panel.val"], {
        cwd: tempRoot,
        io: createOutputCollector().io,
        prompter: createScriptedPrompter({
          texts: [
            "side_panel",
            "other",
            "side_panel",
            "v1",
            "side_front",
            "",
            "(name a new join)",
            "side",
            "side_back",
            ""
          ],
          confirms: [true, true, false]
        })
      });

      // back: 既存 side_back を選んで閉じる。
      await runCli(["node", "loom", "add", "back.val"], {
        cwd: tempRoot,
        io: createOutputCollector().io,
        prompter: createScriptedPrompter({
          texts: ["back", "other", "back", "v1", "side_back", ""],
          confirms: [true, false]
        })
      });

      const checkOut = createOutputCollector();
      const checkExit = await runCli(["node", "loom", "check", tempRoot], {
        cwd: workspaceRoot,
        io: checkOut.io
      });
      const checkText = checkOut.stdout.join("") + checkOut.stderr.join("");

      // 2本とも2パーツの健全なペア。over-pair は出ず、check は通る。
      expect(checkExit).toBe(0);
      expect(checkText).not.toContain("OVERPAIRED");
      expect(checkText).toContain("side_front");
      expect(checkText).toContain("side_back");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects a new join id that collides with a closed seam and re-prompts", async () => {
    // 守る仕様(打ち手 a): 既に2パーツで縫い合わせ済み(closed)の join id に「新しい join」として同名を
    // 付けさせない。相乗りは over-pair の事故になるので弾き、別 id を促す。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-add-clash-"));

    try {
      await runCli(["node", "loom", "init", "--garment", "blouse"], {
        cwd: tempRoot,
        io: createOutputCollector().io
      });
      await writeFile(join(tempRoot, "front.val"), "front source\n", "utf8");
      await writeFile(join(tempRoot, "side_panel.val"), "side_panel source\n", "utf8");
      await writeFile(join(tempRoot, "back.val"), "back source\n", "utf8");

      // front と side_panel が hem を宣言し合い、hem を closed にする。role を分けるため type=other→役割名。
      await runCli(["node", "loom", "add", "front.val"], {
        cwd: tempRoot,
        io: createOutputCollector().io,
        prompter: createScriptedPrompter({
          texts: ["front", "other", "front", "v1", "hem", "hem", ""],
          confirms: [true, false]
        })
      });
      await runCli(["node", "loom", "add", "side_panel.val"], {
        cwd: tempRoot,
        io: createOutputCollector().io,
        prompter: createScriptedPrompter({
          texts: ["side_panel", "other", "side_panel", "v1", "hem", ""],
          confirms: [true, false]
        })
      });

      // back: 新規 join の id に closed の "hem" を渡す(拒否される)→ 別 id "hem_back" を渡す。
      const output = createOutputCollector();
      const exitCode = await runCli(["node", "loom", "add", "back.val"], {
        cwd: tempRoot,
        io: output.io,
        prompter: createScriptedPrompter({
          texts: ["back", "other", "back", "v1", "hem", "hem", "hem_back", ""],
          confirms: [true, false]
        })
      });

      expect(exitCode).toBe(0);
      // 衝突は closed seam として案内され、別 id を促される。
      expect(output.stdout.join("")).toContain("closed seam");
      const backPart = await readFile(join(tempRoot, "parts/back/part.loom"), "utf8");
      expect(backPart).toContain("hem_back:");
      expect(backPart).toContain("type: hem");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("inherits the seam type from the existing open join when connecting to it", async () => {
    // 守る仕様: 既存 open join に繋ぐ第2の当事者は、相手の id と type を継ぐ(同じ縫い目=同じ種類)。
    // 第2の当事者に type を訊き直さないので、id と type が別値(shoulder_lr / shoulder)でも食い違わない。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-add-inherit-"));

    try {
      await runCli(["node", "loom", "init", "--garment", "blouse"], {
        cwd: tempRoot,
        io: createOutputCollector().io
      });
      await writeFile(join(tempRoot, "front.val"), "front source\n", "utf8");
      await writeFile(join(tempRoot, "back.val"), "back source\n", "utf8");

      // front: 新規 join seam type=shoulder id=shoulder_lr(id と type が別値)。role を分けるため type=other→役割名。
      await runCli(["node", "loom", "add", "front.val"], {
        cwd: tempRoot,
        io: createOutputCollector().io,
        prompter: createScriptedPrompter({
          texts: ["front", "other", "front", "v1", "shoulder", "shoulder_lr", ""],
          confirms: [true, false]
        })
      });

      // back: 既存 open join shoulder_lr を選ぶだけ(seam type は訊かれず継承される)。
      const output = createOutputCollector();
      const exitCode = await runCli(["node", "loom", "add", "back.val"], {
        cwd: tempRoot,
        io: output.io,
        prompter: createScriptedPrompter({
          texts: ["back", "other", "back", "v1", "shoulder_lr", ""],
          confirms: [true, false]
        })
      });

      expect(exitCode).toBe(0);
      // 一覧は id・種類[type]・宣言元 role を見せる。
      expect(output.stdout.join("")).toContain("shoulder_lr [shoulder] (front)");
      const backPart = await readFile(join(tempRoot, "parts/back/part.loom"), "utf8");
      // id は選んだ shoulder_lr、type は継いだ shoulder(id にフォールバックしない)。
      expect(backPart).toContain("shoulder_lr:");
      expect(backPart).toContain("type: shoulder");
      expect(backPart).not.toContain("type: shoulder_lr");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("fails cleanly (does not hang) when piped input runs out at a required prompt", async () => {
    // 守る仕様: パイプ入力が足りず、default で埋められない prompt(ここでは type=other の Custom type)に
    // 達したら、空回答で問い直し続けてハングせず、exit 1 で「入力が途中で終了」と案内して終わる。
    // 回帰するとこのテストは戻らず、vitest のタイムアウトで落ちる(=ハングの見張り)。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-add-eof-"));

    try {
      await runCli(["node", "loom", "init"], { cwd: tempRoot, io: createOutputCollector().io });
      await writeFile(join(tempRoot, "body.val"), "body source\n", "utf8");

      const output = createOutputCollector();
      // name="body" を渡し、type select で "6"(other)を選ばせる。続く Custom type の入力は無く EOF。
      const prompter = createReadlinePrompter(
        Readable.from("body\n6\n"),
        new Writable({
          write(_chunk, _encoding, callback) {
            callback();
          }
        })
      );

      const exitCode = await runCli(["node", "loom", "add", "body.val"], {
        cwd: tempRoot,
        io: output.io,
        prompter
      });

      expect(exitCode).toBe(1);
      expect(output.stderr.join("")).toContain("Input ended before all required answers");
      // 途中終了なので part は生成されない。
      await expect(readFile(join(tempRoot, "parts/body/part.loom"), "utf8")).rejects.toThrow();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("re-prompts with a message that matches the actual segment rule (no false 'spaces' claim)", async () => {
    // 守る仕様: role はパス segment になるので isSafePathSegment(slashes / "." / ".." を弾き spaces は許す)で
    // 訊き直す。その再入力文言も規則に合わせ、実際には受け付ける spaces を「禁止」と偽らない。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-add-msg-"));

    try {
      await runCli(["node", "loom", "init"], { cwd: tempRoot, io: createOutputCollector().io });
      await writeFile(
        join(tempRoot, "waist.val"),
        `<?xml version="1.0" encoding="UTF-8"?>
<pattern>
  <draw name="block">
    <details>
      <detail id="1" name="front"></detail>
    </details>
  </draw>
</pattern>`,
        "utf8"
      );

      const output = createOutputCollector();
      // 1回目の Part role にスラッシュ入り(無効)を渡し、2回目で有効名を渡す。
      const exitCode = await runCli(["node", "loom", "add", "waist.val"], {
        cwd: tempRoot,
        io: output.io,
        prompter: createScriptedPrompter({
          texts: ["bad/name", "front", "front", "body", "v1"],
          confirms: [false]
        })
      });

      const stdout = output.stdout.join("");
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Use a single name without slashes or "..".');
      expect(stdout).not.toContain("spaces");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps the part name as a free label without a path-segment constraint", async () => {
    // 守る仕様: name は part.loom のラベルで、パスにもキーにも使わない。role のような単一 segment 制約は
    // 課さず、スラッシュ入りのような isSafePathSegment を通らないラベルもそのまま受け入れる(L59/L73 の決定)。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-add-name-"));

    try {
      await runCli(["node", "loom", "init"], { cwd: tempRoot, io: createOutputCollector().io });
      await writeFile(
        join(tempRoot, "waist.val"),
        `<?xml version="1.0" encoding="UTF-8"?>
<pattern>
  <draw name="block">
    <details>
      <detail id="1" name="front"></detail>
    </details>
  </draw>
</pattern>`,
        "utf8"
      );

      const output = createOutputCollector();
      // role="front"(安全 segment)、name="front/left"(スラッシュ入りの自由ラベル)。
      const exitCode = await runCli(["node", "loom", "add", "waist.val"], {
        cwd: tempRoot,
        io: output.io,
        prompter: createScriptedPrompter({
          texts: ["front", "front/left", "body", "v1"],
          confirms: [false]
        })
      });

      const stdout = output.stdout.join("");
      expect(exitCode).toBe(0);
      expect(stdout).not.toContain('Use a single name without slashes or "..".');
      expect(stdout).toContain('Added part "front/left" as role "front"');
      expect(await readFile(join(tempRoot, "parts/front/part.loom"), "utf8")).toContain(
        "name: front/left"
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("refuses to add a part when the name is already registered", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-add-dup-"));

    try {
      await runCli(["node", "loom", "init"], { cwd: tempRoot, io: createOutputCollector().io });
      await writeFile(join(tempRoot, "body.val"), "body source\n", "utf8");

      const first = createOutputCollector();
      const firstExit = await runCli(["node", "loom", "add", "body.val"], {
        cwd: tempRoot,
        io: first.io,
        prompter: createScriptedPrompter({ texts: ["body", "body", "v1"], confirms: [false] })
      });
      expect(firstExit).toBe(0);

      // 同名の part を再度 add しようとすると既存を黙って上書きせずエラーにする。
      await writeFile(join(tempRoot, "body.val"), "body source\n", "utf8");
      const second = createOutputCollector();
      const secondExit = await runCli(["node", "loom", "add", "body.val"], {
        cwd: tempRoot,
        io: second.io,
        prompter: createScriptedPrompter({ texts: ["body", "body", "v1"], confirms: [false] })
      });

      expect(secondExit).toBe(1);
      expect(second.stderr.join("")).toContain("PART_ADD_ALREADY_REGISTERED");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not overwrite an existing Loomit project with init", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-init-"));

    try {
      const firstOutput = createOutputCollector();
      const firstExitCode = await runCli(["node", "loom", "init"], {
        cwd: tempRoot,
        io: firstOutput.io
      });

      expect(firstExitCode).toBe(0);

      const secondOutput = createOutputCollector();
      const secondExitCode = await runCli(["node", "loom", "init"], {
        cwd: tempRoot,
        io: secondOutput.io
      });

      expect(secondExitCode).toBe(1);
      expect(secondOutput.stderr.join("")).toContain("PROJECT_ALREADY_EXISTS");
      expect(secondOutput.stdout).toEqual([]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("forks a project and keeps prototype notes", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-fork-"));
    const sourcePath = join(tempRoot, "source-blouse");
    const targetPath = join(tempRoot, "target-blouse");

    try {
      await mkdir(sourcePath, { recursive: true });
      const initOutput = createOutputCollector();
      const initExitCode = await runCli(["node", "loom", "init"], {
        cwd: sourcePath,
        io: initOutput.io
      });

      expect(initExitCode).toBe(0);

      await writeFile(
        join(sourcePath, "notes/prototype-notes.yml"),
        [
          "schema: loomit.prototype_notes.v0",
          "notes:",
          "  - id: note-1",
          "    date: 2026-06-28",
          "    result: failed",
          "    issue: armhole tight when raising arms",
          "    creates_test_case: arm-raise",
          "    applies_to:",
          "      - fitted-armhole"
        ].join("\n"),
        "utf8"
      );

      const forkOutput = createOutputCollector();
      const forkExitCode = await runCli(["node", "loom", "fork", sourcePath, targetPath], {
        cwd: workspaceRoot,
        io: forkOutput.io
      });

      expect(forkExitCode).toBe(0);
      expect(forkOutput.stdout.join("")).toContain("Forked Loomit project:");
      expect(await readFile(join(targetPath, "loomit.yml"), "utf8")).toContain(
        "name: target-blouse"
      );
      expect(await readFile(join(targetPath, "notes/prototype-notes.yml"), "utf8")).toContain(
        "creates_test_case: arm-raise"
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("publishes, lists, and adds a part from the library", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-library-"));
    const libraryRoot = join(tempRoot, "library");
    const projectRoot = join(tempRoot, "project");

    try {
      await mkdir(projectRoot, { recursive: true });
      const initOutput = createOutputCollector();
      const initExitCode = await runCli(["node", "loom", "init", "--garment", "blouse"], {
        cwd: projectRoot,
        io: initOutput.io
      });

      expect(initExitCode).toBe(0);

      const publishOutput = createOutputCollector();
      const publishExitCode = await runCli(
        [
          "node",
          "loom",
          "publish",
          join(fixturesRoot, "valid-blouse/parts/sleeve"),
          "--library",
          libraryRoot
        ],
        {
          cwd: workspaceRoot,
          io: publishOutput.io
        }
      );

      expect(publishExitCode).toBe(0);
      expect(publishOutput.stdout.join("")).toContain("Published Loomit part:");
      expect(publishOutput.stderr).toEqual([]);
      expect(await readFile(join(libraryRoot, "sleeves/basic-sleeve/part.loom"), "utf8")).toContain(
        "name: basic-sleeve"
      );

      const listOutput = createOutputCollector();
      const listExitCode = await runCli(
        ["node", "loom", "library", "list", "--library", libraryRoot, "--type", "sleeve"],
        {
          cwd: workspaceRoot,
          io: listOutput.io
        }
      );

      expect(listExitCode).toBe(0);
      expect(listOutput.stdout.join("")).toContain("Loomit library: 1 part");
      expect(listOutput.stdout.join("")).toContain("sleeve/basic-sleeve");
      expect(listOutput.stderr).toEqual([]);

      const addOutput = createOutputCollector();
      const addExitCode = await runCli(
        [
          "node",
          "loom",
          "library",
          "add",
          "sleeve/basic-sleeve",
          projectRoot,
          "--library",
          libraryRoot
        ],
        {
          cwd: workspaceRoot,
          io: addOutput.io
        }
      );

      expect(addExitCode).toBe(0);
      expect(addOutput.stdout.join("")).toContain("Added Loomit library part:");
      expect(await readFile(join(projectRoot, "loomit.yml"), "utf8")).toContain(
        "sleeve: ./parts/sleeve/basic-sleeve/part.loom"
      );
      expect(await readFile(join(projectRoot, "parts/sleeve/basic-sleeve/part.loom"), "utf8"))
        .toContain("name: basic-sleeve");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("builds a project output manifest from referenced part files", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-build-"));

    try {
      await writeCliBuildFixture(tempRoot);

      const output = createOutputCollector();
      const exitCode = await runCli(["node", "loom", "build", tempRoot], {
        cwd: workspaceRoot,
        io: output.io
      });

      expect(exitCode).toBe(0);
      expect(output.stdout.join("")).toContain("Loomit build: ok");
      expect(output.stdout.join("")).toContain("body.source:");
      expect(await readFile(join(tempRoot, "output/manifest.json"), "utf8")).toContain(
        "loomit.build_manifest.v0"
      );
      expect(await readFile(join(tempRoot, "output/parts/body/source/body.val"), "utf8")).toBe(
        "body source\n"
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("surfaces readiness warnings on a successful build (does not silently drop an unregistered .val)", async () => {
    // 守る仕様: build が成功しても、未登録 .val の警告は check と同様にレポートへ載せる(build は止めない)。
    // 以前は成功パスで readiness を握りつぶし、build だけでは stray .val に気づけなかった。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-cli-build-warn-"));

    try {
      await writeCliBuildFixture(tempRoot);
      // parts/ 配下に、どの part の files.source にも該当しない stray .val を置く。
      await writeFile(join(tempRoot, "parts/leftover.val"), "stray source\n", "utf8");

      const output = createOutputCollector();
      const exitCode = await runCli(["node", "loom", "build", tempRoot], {
        cwd: workspaceRoot,
        io: output.io
      });

      const stdout = output.stdout.join("");

      // warning は build を失敗させない(exit 0)が、レポートには出る。
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Loomit build: warning");
      expect(stdout).toContain("UNREGISTERED_VAL_SOURCE");
      expect(stdout).toContain("loom add parts/leftover.val");
      // build 自体は成功して manifest が書かれている。
      expect(await readFile(join(tempRoot, "output/manifest.json"), "utf8")).toContain(
        "loomit.build_manifest.v0"
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("suggests movement tests for a valid blouse", async () => {
    const output = createOutputCollector();
    const exitCode = await runCli(
      ["node", "loom", "suggest-tests", join(fixturesRoot, "valid-blouse")],
      {
        cwd: workspaceRoot,
        io: output.io
      }
    );

    const stdout = output.stdout.join("");

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Loomit suggest-tests: ok");
    expect(stdout).toContain("Recommended:");
    expect(stdout).toContain("- arm-raise");
    expect(output.stderr).toEqual([]);
  });

  it("runs an arm raise movement test for a valid blouse", async () => {
    const output = createOutputCollector();
    const exitCode = await runCli(
      ["node", "loom", "test", "arm-raise", join(fixturesRoot, "valid-blouse")],
      {
        cwd: workspaceRoot,
        io: output.io
      }
    );

    const stdout = output.stdout.join("");

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Loomit test arm-raise: warning");
    expect(stdout).toContain("ARM_RAISE_FITTED_ARMHOLE_RISK");
    expect(output.stderr).toEqual([]);
  });
});

// 対話ウィザードを決定的にテストするための Prompter。input/select は texts を、confirm は confirms を
// 呼び出し順に消費する。使い切ったら空文字/false を返す。
function createScriptedPrompter(script: {
  readonly texts?: readonly string[];
  readonly confirms?: readonly boolean[];
}): Prompter {
  const texts = [...(script.texts ?? [])];
  const confirms = [...(script.confirms ?? [])];

  return {
    input: () => Promise.resolve(texts.shift() ?? ""),
    select: () => Promise.resolve(texts.shift() ?? ""),
    confirm: () => Promise.resolve(confirms.shift() ?? false),
    close: () => undefined
  };
}

function createOutputCollector(): {
  readonly stdout: string[];
  readonly stderr: string[];
  readonly io: {
    readonly stdout: (text: string) => void;
    readonly stderr: (text: string) => void;
  };
} {
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

async function writeCliBuildFixture(projectRoot: string): Promise<void> {
  await mkdir(join(projectRoot, "parts/body"), { recursive: true });

  await writeFile(
    join(projectRoot, "loomit.yml"),
    [
      "schema: loomit.project.v0",
      "name: cli-build-blouse",
      "garment: blouse",
      "parts:",
      "  body: ./parts/body/part.loom",
      "outputs:",
      "  dir: ./output"
    ].join("\n"),
    "utf8"
  );

  await writeFile(
    join(projectRoot, "parts/body/part.loom"),
    [
      "schema: loomit.part.v0",
      "name: cli-build-body",
      "variant: test",
      "type: body",
      "files:",
      "  source: body.val"
    ].join("\n"),
    "utf8"
  );
  await writeFile(join(projectRoot, "parts/body/body.val"), "body source\n", "utf8");
}
