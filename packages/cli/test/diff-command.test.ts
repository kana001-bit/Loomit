import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  diffParts: vi.fn(),
  loadProject: vi.fn(),
  loadProjectedPartWithSource: vi.fn(),
  diffValSources: vi.fn(),
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
  loadProjectedPartWithSource: mocks.loadProjectedPartWithSource,
  diffValSources: mocks.diffValSources,
  loadPrototypeNotesFile: mocks.loadPrototypeNotesFile
}));

import { runDiffCommand } from "../src/commands/diff.js";

describe("runDiffCommand", () => {
  beforeEach(() => {
    mocks.access.mockReset();
    mocks.diffParts.mockReset();
    mocks.loadProject.mockReset();
    mocks.loadProjectedPartWithSource.mockReset();
    mocks.diffValSources.mockReset();
    mocks.loadPrototypeNotesFile.mockReset();
  });

  it("surfaces notes read diagnostics when access fails for reasons other than missing files", async () => {
    // 守る仕様: diff --part は notes/prototype-notes.yml が存在するのに読めない場合、missing 扱いで黙殺せず read 診断を report に載せる。
    // cwd は OS 依存の絶対パス("C:\\...")にせず、実行 OS の絶対パスを使う。
    // diff.ts は resolve(cwd, arg) でパスを組むため、POSIX でも絶対パスとして解決できる必要がある。
    const cwd = join(tmpdir(), "loomit-diff-cwd");
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

    mocks.loadProjectedPartWithSource.mockResolvedValue({
      ok: true,
      value: {
        part: {
          schema: "loomit.part.v0",
          name: "darted-body",
          variant: "front-v1",
          type: "body"
        }
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
        decisionSummary: {
          silhouetteImpact: "none",
          volumeChange: "none",
          connectionRisk: "none",
          prototypeNoteSignal: "none"
        },
        recheckHints: {
          partRole: {
            from: from.type,
            to: to.type,
            changed: from.type !== to.type
          },
          connectors: [],
          requirements: []
        },
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
    // cwd は OS 依存の絶対パス("C:\\...")にせず、実行 OS の絶対パスを使う。
    // diff.ts は resolve(cwd, arg) でパスを組むため、POSIX でも絶対パスとして解決できる必要がある。
    const cwd = join(tmpdir(), "loomit-diff-cwd");
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

  it("renders related prototype note reasons and test case in text output for --part diffs", async () => {
    // 守る仕様: --part diff で prototype notes が読めたら、command の text 出力でも related note の
    // why/test case まで見えるようにする。
    // cwd は OS 依存の絶対パス("C:\\...")にせず、実行 OS の絶対パスを使う。
    // diff.ts は resolve(cwd, arg) でパスを組むため、POSIX でも絶対パスとして解決できる必要がある。
    const cwd = join(tmpdir(), "loomit-diff-cwd");
    const fromProjectPath = join(cwd, "from-project");
    const toProjectPath = join(cwd, "to-project");
    const fromPartPath = join(fromProjectPath, "parts", "body", "part.loom");
    const toPartPath = join(toProjectPath, "parts", "body", "part.loom");
    const fromNotesPath = join(fromProjectPath, "notes", "prototype-notes.yml");
    const toNotesPath = join(toProjectPath, "notes", "prototype-notes.yml");

    mocks.access.mockResolvedValue(undefined);
    mocks.loadProject
      .mockResolvedValueOnce({
        ok: true,
        value: {
          paths: {
            partFilePaths: { body: fromPartPath },
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
            partFilePaths: { body: toPartPath },
            projectRoot: toProjectPath,
            projectFilePath: join(toProjectPath, "loomit.yml")
          }
        },
        diagnostics: []
      });

    mocks.loadProjectedPartWithSource
      .mockResolvedValueOnce({
        ok: true,
        value: {
          part: {
            schema: "loomit.part.v0",
            name: "darted-body",
            variant: "front-v1",
            type: "body"
          }
        },
        diagnostics: []
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          part: {
            schema: "loomit.part.v0",
            name: "darted-body",
            variant: "front-v2",
            type: "body"
          }
        },
        diagnostics: []
      });

    mocks.loadPrototypeNotesFile
      .mockResolvedValueOnce({
        ok: true,
        value: {
          schema: "loomit.prototype_notes.v0",
          notes: [
            {
              id: "note-2026-06-28-armhole",
              date: "2026-06-28",
              result: "failed",
              issue: "outdated version should be replaced",
              creates_test_case: "arm-raise-old",
              applies_to: ["fitted-armhole"]
            }
          ]
        },
        diagnostics: []
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          schema: "loomit.prototype_notes.v0",
          notes: [
            {
              id: "note-2026-06-28-armhole",
              date: "2026-06-28",
              result: "failed",
              issue: "armhole tight when raising arms",
              creates_test_case: "arm-raise",
              applies_to: ["fitted-armhole", "non-stretch-fabric"],
              suggested_change: ["increase armhole ease"]
            }
          ]
        },
        diagnostics: []
      });

    mocks.diffParts.mockImplementation(
      (
        from: { readonly name: string; readonly variant: string; readonly type: string },
        to: { readonly name: string; readonly variant: string; readonly type: string },
        options?: {
          readonly prototypeNotes?: {
            readonly schema: string;
            readonly notes: readonly {
              readonly id: string;
              readonly issue: string;
              readonly creates_test_case: string;
            }[];
          };
        }
      ) => {
        expect(options?.prototypeNotes?.notes).toEqual([
          expect.objectContaining({
            id: "note-2026-06-28-armhole",
            issue: "armhole tight when raising arms",
            creates_test_case: "arm-raise"
          })
        ]);

        return {
          status: "changed",
          decisionSummary: {
            silhouetteImpact: "medium",
            volumeChange: "reduced",
            connectionRisk: "none",
            prototypeNoteSignal: "related-notes-found"
          },
          recheckHints: {
            partRole: {
              from: from.type,
              to: to.type,
              changed: from.type !== to.type
            },
            connectors: [],
            requirements: []
          },
          diagnostics: [],
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
          changes: [
            {
              feature: "dart",
              kind: "modified",
              id: "waist_front",
              before: {
                apex_ref: "val:point#bodice/Apex",
                width_mm: 30,
                legs: { left_ref: "val:point#bodice/Left", right_ref: "val:point#bodice/Right" }
              },
              after: {
                apex_ref: "val:point#bodice/Apex",
                width_mm: 35,
                legs: { left_ref: "val:point#bodice/Left", right_ref: "val:point#bodice/Right" }
              },
              changes: [{ field: "width_mm", before: 30, after: 35 }]
            }
          ],
          relatedNotes: [
            {
              id: "note-2026-06-28-armhole",
              date: "2026-06-28",
              result: "failed",
              issue: "armhole tight when raising arms",
              appliesTo: ["fitted-armhole", "non-stretch-fabric"],
              suggestedChange: ["increase armhole ease"],
              createsTestCase: "arm-raise",
              reasons: [
                {
                  kind: "applies-to-tags",
                  tags: ["fitted-armhole", "non-stretch-fabric"],
                  matchedOn: "both"
                },
                { kind: "changed-feature", feature: "dart", changedIds: ["waist_front"] }
              ]
            }
          ]
        };
      }
    );

    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runDiffCommand(["from-project", "to-project", "--part", "body"], {
      cwd,
      stdout: (text) => {
        stdout.push(text);
      },
      stderr: (text) => {
        stderr.push(text);
      }
    });

    const output = stdout.join("");

    expect(mocks.loadPrototypeNotesFile).toHaveBeenNthCalledWith(1, fromNotesPath);
    expect(mocks.loadPrototypeNotesFile).toHaveBeenNthCalledWith(2, toNotesPath);
    expect(exitCode).toBe(0);
    expect(output).toContain("Loomit diff: changed");
    expect(output).toContain("Related Prototype Notes:");
    expect(output).toContain(
      "why: applies-to tags [fitted-armhole, non-stretch-fabric] (both); changed dart [waist_front]"
    );
    expect(output).toContain("test case: arm-raise");
    expect(output).toContain("suggested_change: increase armhole ease");
    expect(stderr).toEqual([]);
  });

  // 両側とも読めたときは core の diffValSources に委ね、その結果をそのまま report へ渡す(CLI は判定しない)。
  it("passes the compared drafting-source summary straight through", async () => {
    // 守る仕様(should-fire): 製図構造の比較は core の純関数が行い、CLI はその結果を素通しする。
    const summary = { status: "changed", changedParameters: 3 };
    mocks.diffValSources.mockReturnValue(summary);

    await runDraftingSourceDiff(
      { status: "read", text: "<pattern>before</pattern>" },
      { status: "read", text: "<pattern>after</pattern>" }
    );

    expect(mocks.diffValSources).toHaveBeenCalledWith(
      "<pattern>before</pattern>",
      "<pattern>after</pattern>"
    );
    expect(mocks.diffParts.mock.calls[0]?.[2]).toMatchObject({ draftingSource: summary });
  });

  it.each([
    { label: "added", fromSource: { status: "absent" as const }, expected: "added" },
    { label: "removed", toSource: { status: "absent" as const }, expected: "removed" }
  ])(
    "reports a .val that exists on only one side as $label, not as a moved drafting",
    async ({ fromSource, toSource, expected }) => {
      // 守る仕様(should-fire): 片側にしか .val が無いのは「製図が動いた」ではない ── 未コミットなだけのことが
      //           あり、ENOENT は正常系で診断も出ないので、同じ文面にすると動いていない製図を疑わせる。
      //           このドメイン判断が置かれているのは CLI のここだけなので、値でピン留めしておく。
      const read = { status: "read" as const, text: "<pattern/>" };

      await runDraftingSourceDiff(fromSource ?? read, toSource ?? read);

      expect(mocks.diffValSources).not.toHaveBeenCalled();
      expect(mocks.diffParts.mock.calls[0]?.[2]).toMatchObject({
        draftingSource: { status: expected }
      });
    }
  );

  // 製図ソースの信号は「両版とも読めた」ときだけ意味を持つ。読めなかった側を「無い」に潰すと、
  // 「片側だけ .val がある = 製図ソースを付けた/外した = changed」と読んで誤報する。
  it.each([
    {
      label: "one side is unreadable",
      fromSource: { status: "unreadable" as const },
      toSource: { status: "read" as const, text: "<pattern/>" }
    },
    {
      label: "both sides are absent",
      fromSource: { status: "absent" as const },
      toSource: { status: "absent" as const }
    }
  ])("does not claim the drafting source moved when $label", async ({ fromSource, toSource }) => {
    // 守る仕様(must-not-fire): 読めなかった/そもそも無い .val について「動いた」と言わない。読めなかった事実は
    //           PART_SOURCE_VAL_READ_FAILED が伝えるので、diff は黙る(warning と "moved" の同時表示を防ぐ)。
    await runDraftingSourceDiff(fromSource, toSource);

    expect(mocks.diffValSources).not.toHaveBeenCalled();
    expect(mocks.diffParts).toHaveBeenCalledTimes(1);
    const options: unknown = mocks.diffParts.mock.calls[0]?.[2];
    expect(options).not.toHaveProperty("draftingSource");
  });
});

// 製図ソースの状態だけを差し替えて loom diff --part を1回走らせる。project / notes / diffParts の戻りは
// この観点に関係しないので固定値でよい。
async function runDraftingSourceDiff(
  fromSource: { readonly status: string; readonly text?: string },
  toSource: { readonly status: string; readonly text?: string }
): Promise<void> {
  const cwd = join(tmpdir(), "loomit-diff-drafting");
  const part = { schema: "loomit.part.v0", name: "body", variant: "v1", type: "body" };

  mocks.access.mockResolvedValue(undefined);
  mocks.loadPrototypeNotesFile.mockResolvedValue({ ok: true, value: undefined, diagnostics: [] });

  for (const side of ["from", "to"] as const) {
    mocks.loadProject.mockResolvedValueOnce({
      ok: true,
      value: {
        paths: {
          partFilePaths: { body: join(cwd, `${side}-project`, "parts", "body", "part.loom") },
          projectRoot: join(cwd, `${side}-project`),
          projectFilePath: join(cwd, `${side}-project`, "loomit.yml")
        }
      },
      diagnostics: []
    });
  }

  mocks.loadProjectedPartWithSource
    .mockResolvedValueOnce({ ok: true, value: { part, source: fromSource }, diagnostics: [] })
    .mockResolvedValueOnce({ ok: true, value: { part, source: toSource }, diagnostics: [] });

  mocks.diffParts.mockReturnValue({
    status: "same",
    decisionSummary: {
      silhouetteImpact: "none",
      volumeChange: "none",
      connectionRisk: "none",
      prototypeNoteSignal: "none"
    },
    recheckHints: {
      partRole: { from: "body", to: "body", changed: false },
      connectors: [],
      requirements: []
    },
    diagnostics: [],
    from: part,
    to: part,
    changes: [],
    relatedNotes: []
  });

  await runDiffCommand(["from-project", "to-project", "--part", "body"], {
    cwd,
    stdout: () => {},
    stderr: () => {}
  });
}
