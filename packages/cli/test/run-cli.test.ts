import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

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
      expect(initOutput.stdout.join("")).toContain("Created Loomit project:");
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
