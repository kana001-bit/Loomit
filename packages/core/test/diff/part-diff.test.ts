import { describe, expect, it } from "vitest";

import { diffParts } from "../../src/index.js";
import type { Diagnostic, Part, PrototypeNotes } from "../../src/index.js";

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
    expect(report.recheckHints).toEqual({
      partRole: {
        from: "body",
        to: "body",
        changed: false
      },
      connectors: [],
      requirements: []
    });
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

  it("reports added, removed, and modified notches and raises connection risk", () => {
    // 守る仕様: notch diff は id 単位で追加・削除・移動を区別し、合印が動いたら縫い合わせ確認(connectionRisk)を促す。
    //           notch は体積・シルエットには効かないので、それらの気配は none のまま。
    const before = createBodyPart({
      notches: {
        hem_center: {
          seam_ref: "val:seam#bodice/hem",
          position: 0.5,
          type: "single"
        },
        side_top: {
          seam_ref: "val:seam#bodice/side",
          position: 0.25
        }
      }
    });
    const after = createBodyPart({
      notches: {
        armhole_match: {
          seam_ref: "val:seam#bodice/armhole",
          position: 0.6
        },
        side_top: {
          seam_ref: "val:seam#bodice/side",
          position: 0.4
        }
      }
    });

    const report = diffParts(before, after);

    expect(report.status).toBe("changed");
    expect(report.changes).toEqual([
      {
        feature: "notch",
        kind: "added",
        id: "armhole_match",
        after: {
          seam_ref: "val:seam#bodice/armhole",
          position: 0.6
        }
      },
      {
        feature: "notch",
        kind: "removed",
        id: "hem_center",
        before: {
          seam_ref: "val:seam#bodice/hem",
          position: 0.5,
          type: "single"
        }
      },
      {
        feature: "notch",
        kind: "modified",
        id: "side_top",
        before: {
          seam_ref: "val:seam#bodice/side",
          position: 0.25
        },
        after: {
          seam_ref: "val:seam#bodice/side",
          position: 0.4
        },
        changes: [
          {
            field: "position",
            before: 0.25,
            after: 0.4
          }
        ]
      }
    ]);
    expect(report.decisionSummary.connectionRisk).toBe("review-needed");
    expect(report.decisionSummary.silhouetteImpact).toBe("none");
    expect(report.decisionSummary.volumeChange).toBe("none");
    expect(report.relatedNotes).toEqual([]);
  });

  it("detects notch seam and type changes as field-level moves", () => {
    // 守る仕様: notch diff は position だけでなく、seam_ref(どの縫い線へ移したか)と type(合印種別)の
    //          付け外しも、同じ id のフィールド変更として読める形で返す。
    const before = createBodyPart({
      notches: {
        match_a: {
          seam_ref: "val:seam#bodice/side",
          position: 0.5,
          type: "single"
        }
      }
    });
    const after = createBodyPart({
      notches: {
        match_a: {
          seam_ref: "val:seam#bodice/armhole",
          position: 0.5
        }
      }
    });

    const report = diffParts(before, after);

    expect(report.changes).toEqual([
      {
        feature: "notch",
        kind: "modified",
        id: "match_a",
        before: {
          seam_ref: "val:seam#bodice/side",
          position: 0.5,
          type: "single"
        },
        after: {
          seam_ref: "val:seam#bodice/armhole",
          position: 0.5
        },
        changes: [
          {
            field: "seam_ref",
            before: "val:seam#bodice/side",
            after: "val:seam#bodice/armhole"
          },
          {
            field: "type",
            before: "single"
          }
        ]
      }
    ]);
    expect(report.decisionSummary.connectionRisk).toBe("review-needed");
  });

  it("reads a notch depth_mm/width_mm change but does not raise connection risk", () => {
    // 守る仕様: depth_mm(クリップ量) / width_mm(マーク幅)は縫いやすさの調整で、辺が合うか(接続整合)は変えない。
    //           フィールド変更としては読めるが、depth/width だけの変更なら connectionRisk は立てない(誤検知回避)。
    const before = createBodyPart({
      notches: {
        side_top: {
          seam_ref: "val:seam#bodice/side",
          position: 0.5,
          depth_mm: 6,
          width_mm: 3
        }
      }
    });
    const after = createBodyPart({
      notches: {
        side_top: {
          seam_ref: "val:seam#bodice/side",
          position: 0.5,
          depth_mm: 9,
          width_mm: 3
        }
      }
    });

    const report = diffParts(before, after);

    expect(report.changes).toEqual([
      {
        feature: "notch",
        kind: "modified",
        id: "side_top",
        before: {
          seam_ref: "val:seam#bodice/side",
          position: 0.5,
          depth_mm: 6,
          width_mm: 3
        },
        after: {
          seam_ref: "val:seam#bodice/side",
          position: 0.5,
          depth_mm: 9,
          width_mm: 3
        },
        changes: [
          {
            field: "depth_mm",
            before: 6,
            after: 9
          }
        ]
      }
    ]);
    expect(report.decisionSummary.connectionRisk).toBe("none");
    expect(report.decisionSummary.silhouetteImpact).toBe("none");
    expect(report.decisionSummary.volumeChange).toBe("none");
  });

  it("still raises connection risk when a notch moves and its depth changes together", () => {
    // 守る仕様: depth/width の付随変更があっても、position など接続に効くフィールドが動いていれば connectionRisk は立てる。
    //           「depth/width だけ」の変更を接続確認から外す精緻化が、位置移動を取りこぼさないことを固定する。
    const before = createBodyPart({
      notches: {
        side_top: {
          seam_ref: "val:seam#bodice/side",
          position: 0.25,
          depth_mm: 6
        }
      }
    });
    const after = createBodyPart({
      notches: {
        side_top: {
          seam_ref: "val:seam#bodice/side",
          position: 0.4,
          depth_mm: 9
        }
      }
    });

    const report = diffParts(before, after);

    expect(report.decisionSummary.connectionRisk).toBe("review-needed");
  });

  it("links a prototype note when a notch changes", () => {
    // 守る仕様: featureOrder に notch を含むので、notch が変わった差分でも note の「changed-feature」理由に
    //          notch が現れる(合印を動かした試作に過去メモを結び付けられる)。
    const from = createBodyPart({
      tags: ["fitted-armhole"]
    });
    const to = createBodyPart({
      tags: ["fitted-armhole"],
      notches: {
        armhole_match: {
          seam_ref: "val:seam#bodice/armhole",
          position: 0.6
        }
      }
    });
    const prototypeNotes: PrototypeNotes = {
      schema: "loomit.prototype_notes.v0",
      notes: [
        {
          id: "note-2026-07-01-armhole-notch",
          date: "2026-07-01",
          result: "failed",
          issue: "sleeve and body armhole did not line up at the notch",
          creates_test_case: "arm-raise",
          applies_to: ["fitted-armhole"]
        }
      ]
    };

    const report = diffParts(from, to, { prototypeNotes });

    expect(report.relatedNotes).toHaveLength(1);
    // 変更 notch "armhole_match" は note タグ "fitted-armhole" と "armhole" で重なるので、regime レベルの
    // changed-feature ではなく、より鋭い feature-overlap 理由になる(この note は今回動かした合印の話)。
    expect(report.relatedNotes[0]?.reasons).toEqual([
      {
        kind: "applies-to-tags",
        tags: ["fitted-armhole"],
        matchedOn: "both"
      },
      {
        kind: "feature-overlap",
        feature: "notch",
        changedIds: ["armhole_match"],
        matchedTags: ["fitted-armhole"]
      }
    ]);
    expect(report.decisionSummary.prototypeNoteSignal).toBe("related-notes-found");
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
            after: "from=0.76, to=0.84, behavior=ease, allowance_mm=<missing>, ease_ratio=<missing>"
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

  it("extracts seamlint recheck hints from connector, requirement, and part-role changes", () => {
    // 守る仕様: diff report は Seamlint handoff 用に、再確認すべき part role・connector の変更種別・requirement id を機械可読で返す。
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
    const after: Part = {
      ...createBodyPart({
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
      }),
      type: "sleeve"
    };

    const report = diffParts(before, after);

    expect(report.recheckHints).toEqual({
      partRole: {
        from: "body",
        to: "sleeve",
        changed: true
      },
      connectors: [
        {
          id: "armhole",
          changeKinds: ["length", "tolerance", "path", "gathered-range", "range"]
        }
      ],
      requirements: ["fabric.stretch", "sleeve.armhole.length_mm"]
    });
  });

  it("tracks a connector side change in the diff and recheck hints", () => {
    // 守る仕様(assembly (d)): side(所属 unit)の変更は stacked↔contiguous / 側の付け替え = assembly の意味を変える。
    // 同じ id のフィールド変更として diff に載り、recheck hint の changeKinds に "side" として写る。
    const before = createBodyPart({
      connectors: { armhole: { type: "armhole", side: "bodice" } }
    });
    const after = createBodyPart({
      connectors: { armhole: { type: "armhole", side: "sleeve" } }
    });

    const report = diffParts(before, after);

    expect(report.changes).toContainEqual(
      expect.objectContaining({
        feature: "connector",
        kind: "modified",
        id: "armhole",
        changes: expect.arrayContaining([{ field: "side", before: "bodice", after: "sleeve" }])
      })
    );
    expect(report.recheckHints.connectors).toContainEqual({
      id: "armhole",
      changeKinds: ["side"]
    });
  });

  it("surfaces input diagnostics and reflects them in status", () => {
    // 守る仕様: 前段(part load / darts 射影)で出た診断を diff レポートに載せ、status にも反映する。
    const part = createBodyPart({});
    const inputDiagnostic: Diagnostic = {
      severity: "warning",
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
    expect(report.recheckHints.partRole).toEqual({
      from: "body",
      to: "sleeve",
      changed: true
    });
  });

  it("links matching prototype notes with tag and changed-feature reasons", () => {
    // 守る仕様: 実際に変わったフィーチャがある差分で、from/to の tags を満たす note だけを、
    // 「なぜ関連するか」の理由(前提タグ＋変わったフィーチャ)と再走行すべき test case 付きで返す。
    const from = createBodyPart({
      tags: ["fitted-armhole", "non-stretch-fabric"]
    });
    const to = createBodyPart({
      tags: ["fitted-armhole", "non-stretch-fabric", "darted-front"],
      darts: {
        waist_front: {
          apex_ref: "val:point#bodice/Apex",
          width_mm: 30,
          legs: { left_ref: "val:point#bodice/Left", right_ref: "val:point#bodice/Right" }
        }
      }
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
        suggestedChange: ["lower sleeve cap", "increase armhole ease"],
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
    ]);
  });

  it("does not surface prototype notes when tags match but nothing changed", () => {
    // 守る仕様: タグが付いているだけ(差分ゼロ)では related に載せない。過去メモは「今回変わった何か」に
    // 紐づけて初めて判断材料になる。
    const part = createBodyPart({
      tags: ["fitted-armhole", "non-stretch-fabric"]
    });
    const prototypeNotes: PrototypeNotes = {
      schema: "loomit.prototype_notes.v0",
      notes: [
        {
          id: "note-2026-06-28-armhole",
          date: "2026-06-28",
          result: "failed",
          issue: "armhole tight when raising arms",
          creates_test_case: "arm-raise",
          applies_to: ["fitted-armhole", "non-stretch-fabric"]
        }
      ]
    };

    const report = diffParts(part, part, { prototypeNotes });

    expect(report.relatedNotes).toEqual([]);
    expect(report.decisionSummary.prototypeNoteSignal).toBe("none");
  });

  it("prefers feature-overlap reasons over regime changed-feature when the change touches the note's tags", () => {
    // 守る仕様: 変更 connector "armhole" / requirement "sleeve.armhole.length_mm" は note タグ
    // "fitted-armhole" と "armhole" で重なるので feature-overlap 理由になり(種別ごと・id 昇順)、
    // regime レベルの changed-feature は載せない。from にしか無いタグで一致したときは matchedOn=from を残す。
    const from = createBodyPart({
      tags: ["fitted-armhole", "non-stretch-fabric"],
      connectors: {
        armhole: { type: "armhole", length_mm: 469 }
      }
    });
    const to = createBodyPart({
      tags: ["fitted-armhole"],
      connectors: {
        armhole: { type: "armhole", length_mm: 472 }
      },
      requires: {
        "sleeve.armhole.length_mm": { min: 468, max: 474 }
      }
    });
    const prototypeNotes: PrototypeNotes = {
      schema: "loomit.prototype_notes.v0",
      notes: [
        {
          id: "note-2026-06-28-armhole",
          date: "2026-06-28",
          result: "failed",
          issue: "armhole tight when raising arms",
          creates_test_case: "arm-raise",
          applies_to: ["fitted-armhole", "non-stretch-fabric"]
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
        suggestedChange: [],
        createsTestCase: "arm-raise",
        reasons: [
          {
            kind: "applies-to-tags",
            tags: ["fitted-armhole", "non-stretch-fabric"],
            matchedOn: "from"
          },
          {
            kind: "feature-overlap",
            feature: "connector",
            changedIds: ["armhole"],
            matchedTags: ["fitted-armhole"]
          },
          {
            kind: "feature-overlap",
            feature: "requirement",
            changedIds: ["sleeve.armhole.length_mm"],
            matchedTags: ["fitted-armhole"]
          }
        ]
      }
    ]);
  });
  it("ranks a note that touches the change above a regime-only match", () => {
    // 守る仕様: 今回の変更(connector "armhole")を名前で触る note を上位に、regime だけ一致する note を下位に
    // 並べ替える(定義順では regime-only が先でも、feature-overlap を持つ note を持ち上げる)。
    const from = createBodyPart({
      tags: ["fitted-armhole", "non-stretch-fabric"],
      connectors: { armhole: { type: "armhole", length_mm: 469 } }
    });
    const to = createBodyPart({
      tags: ["fitted-armhole", "non-stretch-fabric"],
      connectors: { armhole: { type: "armhole", length_mm: 472 } }
    });
    const prototypeNotes: PrototypeNotes = {
      schema: "loomit.prototype_notes.v0",
      notes: [
        {
          id: "note-regime-only",
          date: "2026-07-02",
          result: "failed",
          issue: "fabric relaxed over time",
          creates_test_case: "relax",
          applies_to: ["non-stretch-fabric"]
        },
        {
          id: "note-touches-armhole",
          date: "2026-07-03",
          result: "failed",
          issue: "armhole tight when raising arms",
          creates_test_case: "arm-raise",
          applies_to: ["fitted-armhole", "non-stretch-fabric"]
        }
      ]
    };

    const report = diffParts(from, to, { prototypeNotes });

    expect(report.relatedNotes.map((note) => note.id)).toEqual([
      "note-touches-armhole",
      "note-regime-only"
    ]);
    expect(report.relatedNotes[0]?.reasons).toContainEqual({
      kind: "feature-overlap",
      feature: "connector",
      changedIds: ["armhole"],
      matchedTags: ["fitted-armhole"]
    });
    // 重なりが無い regime-only note は従来どおり changed-feature 理由のまま(後退なし)。
    expect(report.relatedNotes[1]?.reasons).toContainEqual({
      kind: "changed-feature",
      feature: "connector",
      changedIds: ["armhole"]
    });
  });

  it("cites only the tag that justified each feature in per-feature overlap reasons", () => {
    // 守る仕様: 別々のタグで重なった複数フィーチャがあるとき、各 feature-overlap 理由は自分を結び付けたタグ
    // だけを matchedTags に載せる(全タグを載せて「どのタグでこのフィーチャが関係したのか」を誤解させない)。
    const from = createBodyPart({
      tags: ["fitted-armhole", "gathered-waist"],
      connectors: { armhole: { type: "armhole", length_mm: 469 } }
    });
    const to = createBodyPart({
      tags: ["fitted-armhole", "gathered-waist"],
      connectors: { armhole: { type: "armhole", length_mm: 472 } },
      darts: {
        waist_dart: {
          apex_ref: "val:point#bodice/Apex",
          width_mm: 20,
          legs: { left_ref: "val:point#bodice/L", right_ref: "val:point#bodice/R" }
        }
      }
    });
    const prototypeNotes: PrototypeNotes = {
      schema: "loomit.prototype_notes.v0",
      notes: [
        {
          id: "note-both",
          date: "2026-07-04",
          result: "failed",
          issue: "armhole and waist both off",
          creates_test_case: "fit-check",
          applies_to: ["fitted-armhole", "gathered-waist"]
        }
      ]
    };

    const report = diffParts(from, to, { prototypeNotes });

    const reasons = report.relatedNotes[0]?.reasons ?? [];
    // connector は "armhole" トークンで fitted-armhole にだけ、dart は "waist" で gathered-waist にだけ結び付く。
    expect(reasons).toContainEqual({
      kind: "feature-overlap",
      feature: "dart",
      changedIds: ["waist_dart"],
      matchedTags: ["gathered-waist"]
    });
    expect(reasons).toContainEqual({
      kind: "feature-overlap",
      feature: "connector",
      changedIds: ["armhole"],
      matchedTags: ["fitted-armhole"]
    });
  });

  it("matches non-ASCII (Japanese) tags and feature ids for overlap", () => {
    // 守る仕様: applies_to / connector id は任意の非空文字列を許すので、日本語のタグ/id でも feature-overlap が
    // 発火する(トークン化を ASCII 英数だけに絞らない)。
    const from = createBodyPart({
      tags: ["袖ぐり"],
      connectors: { 袖ぐり: { type: "袖ぐり", length_mm: 469 } }
    });
    const to = createBodyPart({
      tags: ["袖ぐり"],
      connectors: { 袖ぐり: { type: "袖ぐり", length_mm: 472 } }
    });
    const prototypeNotes: PrototypeNotes = {
      schema: "loomit.prototype_notes.v0",
      notes: [
        {
          id: "note-sode",
          date: "2026-07-05",
          result: "failed",
          issue: "袖ぐりがきつい",
          creates_test_case: "arm-raise",
          applies_to: ["袖ぐり"]
        }
      ]
    };

    const report = diffParts(from, to, { prototypeNotes });

    expect(report.relatedNotes[0]?.reasons).toContainEqual({
      kind: "feature-overlap",
      feature: "connector",
      changedIds: ["袖ぐり"],
      matchedTags: ["袖ぐり"]
    });
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

  it("summarizes an added dart as high silhouette impact and reduced volume", () => {
    // 守る仕様: dart の追加は形を大きく動かす気配(high)で、布をつまむ量が増える=ゆとりが減る(reduced)。
    const before = createBodyPart({});
    const after = createBodyPart({
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

    const report = diffParts(before, after);

    expect(report.decisionSummary).toEqual({
      silhouetteImpact: "high",
      volumeChange: "reduced",
      connectionRisk: "none",
      prototypeNoteSignal: "none"
    });
  });

  it("raises silhouette to medium and volume to reduced when a dart is widened", () => {
    // 守る仕様: dart の width_mm を増やすのは寸法変更(medium)で、つまむ量が増える=ゆとりが減る(reduced)。
    const before = createBodyPart({
      darts: {
        waist_front: {
          apex_ref: "val:point#bodice/Apex",
          width_mm: 30,
          legs: {
            left_ref: "val:point#bodice/Left",
            right_ref: "val:point#bodice/Right"
          }
        }
      }
    });
    const after = createBodyPart({
      darts: {
        waist_front: {
          apex_ref: "val:point#bodice/Apex",
          width_mm: 35,
          legs: {
            left_ref: "val:point#bodice/Left",
            right_ref: "val:point#bodice/Right"
          }
        }
      }
    });

    const report = diffParts(before, after);

    expect(report.decisionSummary).toEqual({
      silhouetteImpact: "medium",
      volumeChange: "reduced",
      connectionRisk: "none",
      prototypeNoteSignal: "none"
    });
  });

  it("marks volume as mixed when one dart widens and another narrows", () => {
    // 守る仕様: 一方の dart で width が増え、他方で減るときは方向が混在するので volume は mixed になる。
    const before = createBodyPart({
      darts: {
        waist_front: {
          apex_ref: "val:point#bodice/Apex",
          width_mm: 30,
          legs: { left_ref: "val:point#bodice/L1", right_ref: "val:point#bodice/R1" }
        },
        side_front: {
          apex_ref: "val:point#bodice/SideApex",
          width_mm: 40,
          legs: { left_ref: "val:point#bodice/L2", right_ref: "val:point#bodice/R2" }
        }
      }
    });
    const after = createBodyPart({
      darts: {
        waist_front: {
          apex_ref: "val:point#bodice/Apex",
          width_mm: 35,
          legs: { left_ref: "val:point#bodice/L1", right_ref: "val:point#bodice/R1" }
        },
        side_front: {
          apex_ref: "val:point#bodice/SideApex",
          width_mm: 30,
          legs: { left_ref: "val:point#bodice/L2", right_ref: "val:point#bodice/R2" }
        }
      }
    });

    const report = diffParts(before, after);

    expect(report.decisionSummary.volumeChange).toBe("mixed");
    expect(report.decisionSummary.silhouetteImpact).toBe("medium");
  });

  it("flags connection risk when only requires change, without silhouette or volume signals", () => {
    // 守る仕様: connectors / requires の変更は接続確認要(review-needed)を立てるが、形やゆとりの気配は上げない。
    const before = createBodyPart({
      requires: { "sleeve.armhole.length_mm": { min: 466, max: 472 } }
    });
    const after = createBodyPart({
      requires: { "sleeve.armhole.length_mm": { min: 468, max: 474 } }
    });

    const report = diffParts(before, after);

    expect(report.decisionSummary).toEqual({
      silhouetteImpact: "none",
      volumeChange: "none",
      connectionRisk: "review-needed",
      prototypeNoteSignal: "none"
    });
  });

  it("raises silhouette for gather range changes and flags connection risk", () => {
    // 守る仕様: gather(behavior: gathered)の range が動くと形の気配(medium)を上げ、connector 変更として接続確認要も立てる。
    const before = createBodyPart({
      connectors: {
        armhole: {
          type: "armhole",
          length_mm: 469,
          ranges: [{ id: "cap-gather", from: 0.18, to: 0.72, behavior: "gathered" }]
        }
      }
    });
    const after = createBodyPart({
      connectors: {
        armhole: {
          type: "armhole",
          length_mm: 469,
          ranges: [{ id: "cap-gather", from: 0.2, to: 0.72, behavior: "gathered" }]
        }
      }
    });

    const report = diffParts(before, after);

    expect(report.decisionSummary.silhouetteImpact).toBe("medium");
    expect(report.decisionSummary.connectionRisk).toBe("review-needed");
    expect(report.decisionSummary.volumeChange).toBe("none");
  });

  it("does not raise silhouette for non-gather range changes", () => {
    // 守る仕様: ease など gather 以外の range 変更は形の気配ではなく接続の話なので、silhouette は上げず connectionRisk だけ立てる。
    const before = createBodyPart({
      connectors: {
        armhole: {
          type: "armhole",
          length_mm: 469,
          ranges: [{ id: "ease-window", from: 0.76, to: 0.84, behavior: "ease" }]
        }
      }
    });
    const after = createBodyPart({
      connectors: {
        armhole: {
          type: "armhole",
          length_mm: 469,
          ranges: [{ id: "ease-window", from: 0.78, to: 0.86, behavior: "ease" }]
        }
      }
    });

    const report = diffParts(before, after);

    expect(report.decisionSummary.silhouetteImpact).toBe("none");
    expect(report.decisionSummary.connectionRisk).toBe("review-needed");
  });

  it("signals related prototype notes in the decision summary", () => {
    // 守る仕様: 変更があり関連 prototype note が見つかった差分は prototypeNoteSignal を related-notes-found にする。
    const from = createBodyPart({ tags: ["fitted-armhole", "non-stretch-fabric"] });
    const to = createBodyPart({
      tags: ["fitted-armhole", "non-stretch-fabric"],
      darts: {
        waist_front: {
          apex_ref: "val:point#bodice/Apex",
          width_mm: 30,
          legs: { left_ref: "val:point#bodice/Left", right_ref: "val:point#bodice/Right" }
        }
      }
    });
    const prototypeNotes: PrototypeNotes = {
      schema: "loomit.prototype_notes.v0",
      notes: [
        {
          id: "note-2026-06-28-armhole",
          date: "2026-06-28",
          result: "failed",
          issue: "armhole tight when raising arms",
          creates_test_case: "arm-raise",
          applies_to: ["fitted-armhole", "non-stretch-fabric"]
        }
      ]
    };

    const report = diffParts(from, to, { prototypeNotes });

    expect(report.decisionSummary.prototypeNoteSignal).toBe("related-notes-found");
  });

  it("reports an all-none decision summary when nothing changed", () => {
    // 守る仕様: 差分も関連 note も無いときは、すべての判断シグナルが none になる。
    const part = createBodyPart({});

    const report = diffParts(part, part);

    expect(report.decisionSummary).toEqual({
      silhouetteImpact: "none",
      volumeChange: "none",
      connectionRisk: "none",
      prototypeNoteSignal: "none"
    });
  });

  it("reports an ease band change on a connector range as a field change", () => {
    // 守る仕様: ease_ratio_min/max の変更を diff で拾う。帯は allowance と同じく range 単位の diffable な値。
    const before = createBodyPart({
      connectors: {
        armhole: {
          type: "armhole",
          ranges: [{ id: "ease", from: 0, to: 1, behavior: "ease", ease_ratio_min: 0, ease_ratio_max: 0.05 }]
        }
      }
    });
    const after = createBodyPart({
      connectors: {
        armhole: {
          type: "armhole",
          ranges: [{ id: "ease", from: 0, to: 1, behavior: "ease", ease_ratio_min: 0, ease_ratio_max: 0.08 }]
        }
      }
    });

    const report = diffParts(before, after);

    expect(report.changes).toContainEqual(
      expect.objectContaining({
        feature: "connector",
        kind: "modified",
        id: "armhole",
        changes: expect.arrayContaining([
          { field: "ranges.ease.ease_ratio_max", before: 0.05, after: 0.08 }
        ])
      })
    );
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
