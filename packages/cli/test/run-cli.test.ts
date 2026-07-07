import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";
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

  it("creates a project with init and can check it", async () => {
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

      const checkOutput = createOutputCollector();
      const checkExitCode = await runCli(["node", "loom", "check", projectPath], {
        cwd: workspaceRoot,
        io: checkOutput.io
      });

      expect(checkExitCode).toBe(0);
      expect(checkOutput.stdout.join("")).toContain("Loomit check: ok");
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
        // 回答順: name, type(select), variant, [connector追加?], seam(select), length, [もう1つ?]
        prompter: createScriptedPrompter({
          texts: ["body", "body", "v1", "armhole", "469"],
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
      expect(generatedPart).toContain("length_mm: 469");
      expect(await readFile(join(projectPath, "loomit.yml"), "utf8")).toContain(
        "body: ./parts/body/part.loom"
      );

      // 生成した part を含めて check が通る(= .val を置くだけで検証可能な状態になる)。
      const checkOutput = createOutputCollector();
      const checkExitCode = await runCli(["node", "loom", "check", projectPath], {
        cwd: workspaceRoot,
        io: checkOutput.io
      });

      expect(checkExitCode).toBe(0);
      expect(checkOutput.stdout.join("")).toContain("Loomit check: ok");
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
