import { describe, expect, it } from "vitest";

import { diffParts } from "../../src/index.js";
import type { Part, PrototypeNotes } from "../../src/index.js";

describe("diffParts", () => {
  it("reports no changes when the same dart structure is compared", () => {
    // 守る仕様: 同じ編集フィーチャ集合を比較したとき、domain diff は same になる。
    const part = createBodyPart({
      darts: {
        waist_front: {
          apex_ref: "val:point#bodice/Apex",
          width_mm: 30,
          intake_length_mm: 110,
          legs: {
            left_ref: "val:point#bodice/Left",
            right_ref: "val:point#bodice/Right"
          }
        }
      }
    });

    const report = diffParts(part, part);

    expect(report.status).toBe("same");
    expect(report.changes).toEqual([]);
    expect(report.diagnostics).toEqual([]);
    expect(report.relatedNotes).toEqual([]);
  });

  it("reports added, removed, and modified darts by stable id", () => {
    // 守る仕様: dart diff は blob 比較ではなく id 単位で追加・削除・変更を区別する。
    const before = createBodyPart({
      darts: {
        waist_front: {
          apex_ref: "val:point#bodice/Apex",
          width_mm: 30,
          intake_length_mm: 110,
          legs: {
            left_ref: "val:point#bodice/Left",
            right_ref: "val:point#bodice/Right"
          }
        },
        shoulder_front: {
          apex_ref: "val:point#bodice/ShoulderApex",
          width_formula: "dart_width_shoulder",
          intake_length_formula: "CurrentLength/2",
          legs: {
            left_ref: "val:point#bodice/ShoulderLeft",
            right_ref: "val:point#bodice/ShoulderRight"
          }
        }
      }
    });
    const after = createBodyPart({
      darts: {
        waist_front: {
          apex_ref: "val:point#bodice/Apex",
          width_mm: 35,
          intake_length_mm: 120,
          legs: {
            left_ref: "val:point#bodice/Left",
            right_ref: "val:point#bodice/RightMoved"
          }
        },
        bust_front: {
          apex_ref: "val:point#bodice/BustApex",
          width_formula: "bust_dart_width",
          legs: {
            left_ref: "val:point#bodice/BustLeft",
            right_ref: "val:point#bodice/BustRight"
          }
        }
      }
    });

    const report = diffParts(before, after);

    expect(report.status).toBe("changed");
    expect(report.changes).toEqual([
      {
        feature: "dart",
        kind: "added",
        id: "bust_front",
        after: {
          apex_ref: "val:point#bodice/BustApex",
          width_formula: "bust_dart_width",
          legs: {
            left_ref: "val:point#bodice/BustLeft",
            right_ref: "val:point#bodice/BustRight"
          }
        }
      },
      {
        feature: "dart",
        kind: "removed",
        id: "shoulder_front",
        before: {
          apex_ref: "val:point#bodice/ShoulderApex",
          width_formula: "dart_width_shoulder",
          intake_length_formula: "CurrentLength/2",
          legs: {
            left_ref: "val:point#bodice/ShoulderLeft",
            right_ref: "val:point#bodice/ShoulderRight"
          }
        }
      },
      {
        feature: "dart",
        kind: "modified",
        id: "waist_front",
        before: {
          apex_ref: "val:point#bodice/Apex",
          width_mm: 30,
          intake_length_mm: 110,
          legs: {
            left_ref: "val:point#bodice/Left",
            right_ref: "val:point#bodice/Right"
          }
        },
        after: {
          apex_ref: "val:point#bodice/Apex",
          width_mm: 35,
          intake_length_mm: 120,
          legs: {
            left_ref: "val:point#bodice/Left",
            right_ref: "val:point#bodice/RightMoved"
          }
        },
        changes: [
          {
            field: "width_mm",
            before: 30,
            after: 35
          },
          {
            field: "intake_length_mm",
            before: 110,
            after: 120
          },
          {
            field: "legs.right_ref",
            before: "val:point#bodice/Right",
            after: "val:point#bodice/RightMoved"
          }
        ]
      }
    ]);
    expect(report.relatedNotes).toEqual([]);
  });

  it("reports connector and requirement changes semantically", () => {
    // 守る仕様: 接続部や requires の変更も blob 差分ではなく、編集対象フィールドとして読める形で返す。
    const before = createBodyPart({
      connectors: {
        armhole: {
          type: "armhole",
          length_mm: 469,
          tolerance_mm: 3,
          path_ref: "svg:path#body-armhole",
          ranges: [
            {
              id: "sleeve-cap-gather",
              from: 0.18,
              to: 0.72,
              behavior: "gathered",
              allowance_mm: 18
            }
          ]
        }
      },
      requires: {
        "sleeve.armhole.length_mm": {
          min: 466,
          max: 472
        }
      }
    });
    const after = createBodyPart({
      connectors: {
        armhole: {
          type: "armhole",
          length_mm: 472,
          tolerance_mm: 5,
          path_ref: "svg:path#body-armhole-updated",
          ranges: [
            {
              id: "sleeve-cap-gather",
              from: 0.2,
              to: 0.75,
              behavior: "gathered",
              allowance_mm: 20
            },
            {
              id: "ease-window",
              from: 0.76,
              to: 0.84,
              behavior: "ease"
            }
          ]
        }
      },
      requires: {
        "sleeve.armhole.length_mm": {
          min: 468,
          max: 474
        },
        "fabric.stretch": {
          equals: false
        }
      }
    });

    const report = diffParts(before, after);

    expect(report.status).toBe("changed");
    expect(report.changes).toEqual([
      {
        feature: "connector",
        kind: "modified",
        id: "armhole",
        before: {
          type: "armhole",
          length_mm: 469,
          tolerance_mm: 3,
          path_ref: "svg:path#body-armhole",
          ranges: [
            {
              id: "sleeve-cap-gather",
              from: 0.18,
              to: 0.72,
              behavior: "gathered",
              allowance_mm: 18
            }
          ]
        },
        after: {
          type: "armhole",
          length_mm: 472,
          tolerance_mm: 5,
          path_ref: "svg:path#body-armhole-updated",
          ranges: [
            {
              id: "sleeve-cap-gather",
              from: 0.2,
              to: 0.75,
              behavior: "gathered",
              allowance_mm: 20
            },
            {
              id: "ease-window",
              from: 0.76,
              to: 0.84,
              behavior: "ease"
            }
          ]
        },
        changes: [
          {
            field: "length_mm",
            before: 469,
            after: 472
          },
          {
            field: "tolerance_mm",
            before: 3,
            after: 5
          },
          {
            field: "path_ref",
            before: "svg:path#body-armhole",
            after: "svg:path#body-armhole-updated"
          },
          {
            field: "ranges.ease-window",
            after: "from=0.76, to=0.84, behavior=ease, allowance_mm=<missing>"
          },
          {
            field: "ranges.sleeve-cap-gather.from",
            before: 0.18,
            after: 0.2
          },
          {
            field: "ranges.sleeve-cap-gather.to",
            before: 0.72,
            after: 0.75
          },
          {
            field: "ranges.sleeve-cap-gather.allowance_mm",
            before: 18,
            after: 20
          }
        ]
      },
      {
        feature: "requirement",
        kind: "added",
        id: "fabric.stretch",
        after: {
          equals: false
        }
      },
      {
        feature: "requirement",
        kind: "modified",
        id: "sleeve.armhole.length_mm",
        before: {
          min: 466,
          max: 472
        },
        after: {
          min: 468,
          max: 474
        },
        changes: [
          {
            field: "min",
            before: 466,
            after: 468
          },
          {
            field: "max",
            before: 472,
            after: 474
          }
        ]
      }
    ]);
    expect(report.relatedNotes).toEqual([]);
  });

  it("surfaces input diagnostics and reflects them in status", () => {
    // 守る仕様: 前段(part load / darts 射影)で出た診断を diff レポートに載せ、status にも反映する。
    const part = createBodyPart({});
    const inputDiagnostic = {
      severity: "warning" as const,
      code: "PART_SOURCE_VAL_READ_FAILED",
      message:
        "source.val からダーツを読み取れませんでした。 / Could not read darts from source.val.",
      target: "from.val"
    };

    const report = diffParts(part, part, { inputDiagnostics: [inputDiagnostic] });

    expect(report.status).toBe("warning");
    expect(report.diagnostics).toContainEqual(inputDiagnostic);
  });

  it("warns when comparing different part identities", () => {
    // 守る仕様: 異なる part name/type を比較するときは diff 自体は返しつつ、レビュー時に warning を出す。
    const from = createBodyPart({});
    const to: Part = {
      ...createBodyPart({}),
      name: "other-part",
      type: "sleeve"
    };

    const report = diffParts(from, to);

    expect(report.status).toBe("warning");
    expect(report.diagnostics).toEqual([
      {
        severity: "warning",
        code: "PART_DIFF_TYPE_CHANGED",
        message: 'Comparing part type "body" to "sleeve".',
        suggestion: [
          "Compare parts with the same role/type when reviewing seam and silhouette changes."
        ]
      },
      {
        severity: "warning",
        code: "PART_DIFF_NAME_CHANGED",
        message: 'Comparing part name "darted-body" to "other-part".',
        suggestion: [
          "If this is meant to be the same evolving part, prefer keeping the base name stable and changing variant or feature fields."
        ]
      }
    ]);
    expect(report.relatedNotes).toEqual([]);
  });

  it("links matching prototype notes by part tags", () => {
    // 守る仕様: diff に prototype notes を紐づけるときは、from/to part の tags を満たす note だけを返す。
    const from = createBodyPart({
      tags: ["fitted-armhole", "non-stretch-fabric"]
    });
    const to = createBodyPart({
      tags: ["fitted-armhole", "non-stretch-fabric", "darted-front"]
    });
    const prototypeNotes: PrototypeNotes = {
      schema: "loomit.prototype_notes.v0",
      notes: [
        {
          id: "note-2026-06-28-armhole",
          date: "2026-06-28",
          result: "failed",
          issue: "armhole tight when raising arms",
          suggested_change: ["lower sleeve cap", "increase armhole ease"],
          creates_test_case: "arm-raise",
          applies_to: ["fitted-armhole", "non-stretch-fabric"]
        },
        {
          id: "note-unmatched",
          date: "2026-06-29",
          result: "failed",
          issue: "not relevant",
          applies_to: ["bias-cut"],
          creates_test_case: "twist"
        }
      ]
    };

    const report = diffParts(from, to, { prototypeNotes });

    expect(report.relatedNotes).toEqual([
      {
        id: "note-2026-06-28-armhole",
        date: "2026-06-28",
        result: "failed",
        issue: "armhole tight when raising arms",
        appliesTo: ["fitted-armhole", "non-stretch-fabric"],
        suggestedChange: ["lower sleeve cap", "increase armhole ease"]
      }
    ]);
  });
  it("does not match prototype notes from tags split across revisions", () => {
    // 守る仕様: prototype note は from/to のタグ和集合ではなく、どちらか一方の revision で成立した場合だけ related に載せる。
    const from = createBodyPart({
      tags: ["fitted-armhole"]
    });
    const to = createBodyPart({
      tags: ["non-stretch-fabric"]
    });
    const prototypeNotes: PrototypeNotes = {
      schema: "loomit.prototype_notes.v0",
      notes: [
        {
          id: "note-2026-06-28-armhole",
          date: "2026-06-28",
          result: "failed",
          issue: "armhole tight when raising arms",
          suggested_change: ["increase armhole ease"],
          creates_test_case: "arm-raise",
          applies_to: ["fitted-armhole", "non-stretch-fabric"]
        }
      ]
    };

    const report = diffParts(from, to, { prototypeNotes });

    expect(report.relatedNotes).toEqual([]);
  });
});

function createBodyPart(part: Partial<Part>): Part {
  return {
    schema: "loomit.part.v0",
    name: "darted-body",
    variant: "front-v1",
    type: "body",
    ...part
  };
}
