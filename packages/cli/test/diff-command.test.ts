import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  diffParts: vi.fn(),
  loadProject: vi.fn(),
  loadProjectedPart: vi.fn(),
  loadPrototypeNotesFile: vi.fn()
}));

vi.mock("node:fs/promises", () => ({
  access: mocks.access
}));

vi.mock("@loomit/core", () => ({
  createDiagnostic: (diagnostic: unknown) => diagnostic,
  diffParts: mocks.diffParts,
  getErrno: (error: unknown) => {
    if (error instanceof Error && "code" in error) {
      const code: unknown = error.code;
      return typeof code === "string" ? code : undefined;
    }

    return undefined;
  },
  loadProject: mocks.loadProject,
  loadProjectedPart: mocks.loadProjectedPart,
  loadPrototypeNotesFile: mocks.loadPrototypeNotesFile
}));

import { runDiffCommand } from "../src/commands/diff.js";

describe("runDiffCommand", () => {
  beforeEach(() => {
    mocks.access.mockReset();
    mocks.diffParts.mockReset();
    mocks.loadProject.mockReset();
    mocks.loadProjectedPart.mockReset();
    mocks.loadPrototypeNotesFile.mockReset();
  });

  it("surfaces notes read diagnostics when access fails for reasons other than missing files", async () => {
    // 守る仕様: diff --part は notes/prototype-notes.yml が存在するのに読めない場合、missing 扱いで黙殺せず read 診断を report に載せる。
    const cwd = "C:\\workspace";
    const fromProjectPath = join(cwd, "from-project");
    const toProjectPath = join(cwd, "to-project");
    const fromNotesPath = join(fromProjectPath, "notes", "prototype-notes.yml");
    const toNotesPath = join(toProjectPath, "notes", "prototype-notes.yml");

    mocks.loadProject
      .mockResolvedValueOnce({
        ok: true,
        value: {
          paths: {
            partFilePaths: {
              body: join(fromProjectPath, "parts", "body", "part.loom")
            },
            projectRoot: fromProjectPath,
            projectFilePath: join(fromProjectPath, "loomit.yml")
          }
        },
        diagnostics: []
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          paths: {
            partFilePaths: {
              body: join(toProjectPath, "parts", "body", "part.loom")
            },
            projectRoot: toProjectPath,
            projectFilePath: join(toProjectPath, "loomit.yml")
          }
        },
        diagnostics: []
      });

    mocks.loadProjectedPart.mockResolvedValue({
      ok: true,
      value: {
        schema: "loomit.part.v0",
        name: "darted-body",
        variant: "front-v1",
        type: "body"
      },
      diagnostics: []
    });

    // access はプロジェクトパスの存在確認(実在扱い)と notes パスの両方で呼ばれるため、
    // 呼び出し順ではなくパスで振り分ける。fromNotes は missing、toNotes は read 失敗(EACCES)。
    mocks.access.mockImplementation(async (candidate: string) => {
      if (candidate === fromNotesPath) {
        throw Object.assign(new Error("not found"), { code: "ENOENT" });
      }

      if (candidate === toNotesPath) {
        throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      }

      return undefined;
    });

    mocks.loadPrototypeNotesFile.mockResolvedValue({
      ok: false,
      diagnostics: [
        {
          severity: "error",
          code: "FILE_READ_FAILED",
          message: "Could not read the file. (permission denied)",
          target: toNotesPath,
          suggestion: ["Check file and directory permissions."]
        }
      ]
    });

    mocks.diffParts.mockImplementation(
      (
        from: { readonly name: string; readonly variant: string; readonly type: string },
        to: { readonly name: string; readonly variant: string; readonly type: string },
        options?: {
          readonly inputDiagnostics?: readonly {
            readonly severity: "info" | "warning" | "error";
            readonly code: string;
            readonly message: string;
            readonly target?: string;
          }[];
        }
      ) => ({
        status: options?.inputDiagnostics?.some((diagnostic) => diagnostic.severity === "error")
          ? "error"
          : "same",
        diagnostics: options?.inputDiagnostics ?? [],
        from: {
          name: from.name,
          variant: from.variant,
          type: from.type
        },
        to: {
          name: to.name,
          variant: to.variant,
          type: to.type
        },
        changes: [],
        relatedNotes: []
      })
    );

    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runDiffCommand(
      ["from-project", "to-project", "--part", "body", "--format", "json"],
      {
        cwd,
        stdout: (text) => {
          stdout.push(text);
        },
        stderr: (text) => {
          stderr.push(text);
        }
      }
    );

    const report = JSON.parse(stdout.join("")) as {
      readonly status: string;
      readonly diagnostics: readonly { readonly code: string; readonly target?: string }[];
    };

    expect(mocks.loadPrototypeNotesFile).toHaveBeenCalledWith(toNotesPath);
    expect(exitCode).toBe(1);
    expect(report.status).toBe("error");
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "FILE_READ_FAILED",
        target: toNotesPath
      })
    );
    expect(stderr).toEqual([]);
  });

  it("reports an access failure (not a missing-path typo) when a --part project path is unreadable", async () => {
    // 守る仕様: 存在チェックは ENOENT のみ「存在しない(タイポ)」扱いにし、権限拒否等は
    // PROJECT_PATH_NOT_FOUND ではなくアクセス失敗として案内する。loadOptionalPrototypeNotes と揃える。
    const cwd = "C:\\workspace";
    const toProjectPath = join(cwd, "to-project");

    mocks.access.mockImplementation(async (candidate: string) => {
      if (candidate === toProjectPath) {
        throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      }

      return undefined;
    });

    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runDiffCommand(
      ["from-project", "to-project", "--part", "body", "--format", "json"],
      {
        cwd,
        stdout: (text) => {
          stdout.push(text);
        },
        stderr: (text) => {
          stderr.push(text);
        }
      }
    );

    const report = JSON.parse(stdout.join("")) as {
      readonly status: string;
      readonly diagnostics: readonly { readonly code: string; readonly target?: string }[];
    };

    expect(exitCode).toBe(1);
    expect(report.status).toBe("error");
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "PROJECT_PATH_ACCESS_FAILED",
        target: toProjectPath
      })
    );
    // 権限拒否を「存在しない」と誤案内しないこと。
    expect(report.diagnostics.some((diagnostic) => diagnostic.code === "PROJECT_PATH_NOT_FOUND")).toBe(
      false
    );
    // 存在確認で弾くため loadProject までは進まない。
    expect(mocks.loadProject).not.toHaveBeenCalled();
    expect(stderr).toEqual([]);
  });
});
