import type { PartDiffReport } from "@loomit/core";

import { describe, expect, it } from "vitest";

import { formatDiffText } from "../src/formatters/diffText.js";

// 宣言・射影フィーチャに差分の無い(changes 空)report。製図ソースの信号だけを差し替えて比べる。
function reportWithDraftingSource(
  draftingSource: NonNullable<PartDiffReport["draftingSource"]>
): PartDiffReport {
  return {
    status: "same",
    decisionSummary: {
      silhouetteImpact: "none",
      volumeChange: "none",
      connectionRisk: "none",
      prototypeNoteSignal: "none"
    },
    draftingSource,
    recheckHints: {
      partRole: { from: "body", to: "body", changed: false },
      connectors: [],
      requirements: []
    },
    diagnostics: [],
    from: { name: "waistband", variant: "v1", type: "body" },
    to: { name: "waistband", variant: "v1", type: "body" },
    changes: [],
    relatedNotes: []
  };
}

describe("formatDiffText", () => {
  it("prints the decision summary before diagnostics and changes", () => {
    // 守る仕様: keep / discard 判断に効く summary を、詳細(diagnostics / changes)より先に表示する。
    const report: PartDiffReport = {
      status: "changed",
      decisionSummary: {
        silhouetteImpact: "high",
        volumeChange: "reduced",
        connectionRisk: "review-needed",
        prototypeNoteSignal: "related-notes-found"
      },
      recheckHints: {
        partRole: {
          from: "body",
          to: "body",
          changed: false
        },
        connectors: [{ id: "armhole", changeKinds: ["length", "path", "gathered-range"] }],
        requirements: ["sleeve.armhole.length_mm"]
      },
      diagnostics: [
        {
          severity: "warning",
          code: "PART_DIFF_TYPE_CHANGED",
          message: 'Comparing part type "body" to "sleeve".'
        }
      ],
      from: { name: "darted-body", variant: "front-v1", type: "body" },
      to: { name: "darted-body", variant: "front-v2", type: "body" },
      changes: [
        {
          feature: "dart",
          kind: "added",
          id: "waist_front",
          after: {
            apex_ref: "val:point#bodice/Apex",
            width_mm: 30,
            legs: { left_ref: "val:point#bodice/Left", right_ref: "val:point#bodice/Right" }
          }
        }
      ],
      relatedNotes: []
    };

    const output = formatDiffText(report);

    const summaryIndex = output.indexOf("Summary:");
    const recheckIndex = output.indexOf("Recheck Hints:");
    const diagnosticsIndex = output.indexOf("Diagnostics:");
    const changesIndex = output.indexOf("Changes:");

    expect(summaryIndex).toBeGreaterThanOrEqual(0);
    expect(summaryIndex).toBeLessThan(recheckIndex);
    expect(recheckIndex).toBeLessThan(diagnosticsIndex);
    expect(diagnosticsIndex).toBeLessThan(changesIndex);
    expect(output).toContain("silhouette impact: high");
    expect(output).toContain("volume change:     reduced");
    expect(output).toContain("connection risk:   review-needed");
    expect(output).toContain("prototype notes:   related-notes-found");
    expect(output).toContain("Recheck Hints:");
    expect(output).toContain("part role: body");
    expect(output).toContain("connectors:");
    expect(output).toContain("- armhole (length, path, gathered-range)");
    expect(output).toContain("requirements:");
    expect(output).toContain("- sleeve.armhole.length_mm");
  });

  it("always renders the summary even when there are no semantic changes", () => {
    // 守る仕様: 差分が無い場合でも summary は常に出す(判断シグナルの有無を先頭で一貫して読めるようにする)。
    const report: PartDiffReport = {
      status: "same",
      decisionSummary: {
        silhouetteImpact: "none",
        volumeChange: "none",
        connectionRisk: "none",
        prototypeNoteSignal: "none"
      },
      recheckHints: {
        partRole: {
          from: "body",
          to: "body",
          changed: false
        },
        connectors: [],
        requirements: []
      },
      diagnostics: [],
      from: { name: "darted-body", variant: "front-v1", type: "body" },
      to: { name: "darted-body", variant: "front-v1", type: "body" },
      changes: [],
      relatedNotes: []
    };

    const output = formatDiffText(report);

    expect(output).toContain("Summary:");
    expect(output).toContain("Recheck Hints:");
    expect(output).toContain("connectors: none");
    expect(output).toContain("requirements: none");
    expect(output).toContain("silhouette impact: none");
    expect(output).toContain("No semantic changes.");
    // 製図ソースの情報が無い report では余計な行を出さない。
    expect(output).not.toContain("drafting source:");
  });

  it("does not report a moved drafting source as 'no semantic changes'", () => {
    // 守る仕様: 宣言も射影フィーチャも同一(changes 空)でも、.val の製図式が動いていれば「変更なし」で終わらせない。
    //           これを黙ると、製図式を変えた作者に「Loomit は何も見ていない」と映る(実際に踏まれた)。幾何は
    //           Loomit では出せないので、測る次の一手(loom slnt check)まで案内する。
    const output = formatDiffText(reportWithDraftingSource({ status: "changed", changedParameters: 1 }));

    expect(output).toContain("drafting source:   changed (1 parameter)");
    expect(output).toContain("No changes to the declared structure");
    expect(output).toContain("loom slnt check");
    expect(output).not.toContain("No semantic changes.");
    // 1つの .val を複数 part が共有するので、「この part の製図が動いた」と断定してはいけない([C6])。
    expect(output).toContain("does not say the change landed on this part");
  });

  it("keeps the plain wording when the drafting source did not move", () => {
    // 守る仕様(must-not-fire): .val を比べたうえで同一だったときは、従来どおり簡潔に終わる。
    const output = formatDiffText(reportWithDraftingSource({ status: "same", changedParameters: 0 }));

    expect(output).toContain("drafting source:   same");
    expect(output).toContain("No semantic changes.");
    expect(output).not.toContain("loom slnt check");
  });

  it.each([
    { status: "added" as const, phrase: "is present in the To version but not in the From version" },
    { status: "removed" as const, phrase: "is present in the From version but not in the To version" }
  ])("says the .val is only on one side ($status) instead of saying it moved", ({ status, phrase }) => {
    // 守る仕様: 片側にしか .val が無いのは「製図が動いた」ではない。.val がその版に未コミットなだけのことがあり
    //           (ENOENT は正常系で診断も出ない)、同じ文面にすると動いていない製図を疑わせる。
    //           どちらの版に在るかは見出し(From: / To:)と同じ語で指す ── "here" ではどちらを見るか決まらない。
    const output = formatDiffText(reportWithDraftingSource({ status }));

    expect(output).toContain(`drafting source:   ${status}`);
    expect(output).toContain(phrase);
    // "removed" が "moved" を部分文字列として含むので、文面そのもので照合する。
    expect(output).not.toContain("drafted from moved");
    // 比べられていないので、測れば分かるかのような案内もしない。
    expect(output).not.toContain("loom slnt check");
  });

  it("renders why (tags + changed features) and the note test case for related notes", () => {
    // 守る仕様: related note は「なぜ関連するか」(前提タグ＋変わったフィーチャ)と再走行すべき test case を短く出す。
    const report: PartDiffReport = {
      status: "changed",
      decisionSummary: {
        silhouetteImpact: "medium",
        volumeChange: "reduced",
        connectionRisk: "none",
        prototypeNoteSignal: "related-notes-found"
      },
      recheckHints: {
        partRole: {
          from: "body",
          to: "body",
          changed: false
        },
        connectors: [],
        requirements: []
      },
      diagnostics: [],
      from: { name: "darted-body", variant: "front-v1", type: "body" },
      to: { name: "darted-body", variant: "front-v2", type: "body" },
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

    const output = formatDiffText(report);

    expect(output).toContain("Related Prototype Notes:");
    expect(output).toContain("- note-2026-06-28-armhole (failed, 2026-06-28)");
    expect(output).toContain(
      "why: applies-to tags [fitted-armhole, non-stretch-fabric] (both); changed dart [waist_front]"
    );
    expect(output).toContain("test case: arm-raise");
    expect(output).toContain("suggested_change: increase armhole ease");
  });

  it("renders a feature-overlap reason as 'touches' with the tag it matched on", () => {
    // 守る仕様: 今回の変更を名前で触る note は、regime レベルの「changed」より鋭い「touches ... (via タグ)」で出す。
    const report: PartDiffReport = {
      status: "changed",
      decisionSummary: {
        silhouetteImpact: "none",
        volumeChange: "none",
        connectionRisk: "review-needed",
        prototypeNoteSignal: "related-notes-found"
      },
      recheckHints: {
        partRole: { from: "body", to: "body", changed: false },
        connectors: [],
        requirements: []
      },
      diagnostics: [],
      from: { name: "body", variant: "v1", type: "body" },
      to: { name: "body", variant: "v2", type: "body" },
      changes: [
        {
          feature: "connector",
          kind: "modified",
          id: "armhole",
          before: { type: "armhole", length_mm: 469 },
          after: { type: "armhole", length_mm: 472 },
          changes: [{ field: "length_mm", before: 469, after: 472 }]
        }
      ],
      relatedNotes: [
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
              matchedOn: "both"
            },
            {
              kind: "feature-overlap",
              feature: "connector",
              changedIds: ["armhole"],
              matchedTags: ["fitted-armhole"]
            }
          ]
        }
      ]
    };

    const output = formatDiffText(report);

    expect(output).toContain(
      "why: applies-to tags [fitted-armhole, non-stretch-fabric] (both); touches connector [armhole] (via fitted-armhole)"
    );
  });
});
