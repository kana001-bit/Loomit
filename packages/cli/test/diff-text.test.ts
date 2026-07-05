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
    const diagnosticsIndex = output.indexOf("Diagnostics:");
    const changesIndex = output.indexOf("Changes:");

    expect(summaryIndex).toBeGreaterThanOrEqual(0);
    expect(summaryIndex).toBeLessThan(diagnosticsIndex);
    expect(diagnosticsIndex).toBeLessThan(changesIndex);
    expect(output).toContain("silhouette impact: high");
    expect(output).toContain("volume change:     reduced");
    expect(output).toContain("connection risk:   review-needed");
    expect(output).toContain("prototype notes:   related-notes-found");
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
      diagnostics: [],
      from: { name: "darted-body", variant: "front-v1", type: "body" },
      to: { name: "darted-body", variant: "front-v1", type: "body" },
      changes: [],
      relatedNotes: []
    };

    const output = formatDiffText(report);

    expect(output).toContain("Summary:");
    expect(output).toContain("silhouette impact: none");
    expect(output).toContain("No semantic changes.");
  });
});
