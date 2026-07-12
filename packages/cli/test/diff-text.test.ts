import type { PartDiffReport } from "@loomit/core";

import { describe, expect, it } from "vitest";

import { formatDiffText } from "../src/formatters/diffText.js";

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
