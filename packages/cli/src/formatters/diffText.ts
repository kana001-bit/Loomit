import type { PartDiffReport } from "@loomit/core";

import { formatDiagnosticsText } from "./diagnosticsText.js";

export function formatDiffText(report: PartDiffReport): string {
  const lines = [`Loomit diff: ${report.status}`];

  lines.push(
    `From: ${report.from.name}@${report.from.variant} (${report.from.type})`,
    `To:   ${report.to.name}@${report.to.variant} (${report.to.type})`
  );

  // keep / discard 判断に効く要約を、詳細(diagnostics / changes)より先に出す。
  lines.push(
    "",
    "Summary:",
    `  silhouette impact: ${report.decisionSummary.silhouetteImpact}`,
    `  volume change:     ${report.decisionSummary.volumeChange}`,
    `  connection risk:   ${report.decisionSummary.connectionRisk}`,
    `  prototype notes:   ${report.decisionSummary.prototypeNoteSignal}`,
    // 製図ソースの行は Summary の中に置く。status が same でも見出し直後で目に入る位置でないと、
    // 「.val を変えたのに Loomit は何も言わない」という読まれ方が消えない。
    ...(report.draftingSource === undefined
      ? []
      : [`  drafting source:   ${formatDraftingSource(report.draftingSource)}`])
  );

  lines.push(
    "",
    "Recheck Hints:",
    `  part role: ${formatPartRoleHint(report.recheckHints.partRole)}`,
    ...formatConnectorHints(report.recheckHints.connectors),
    ...formatRequirementHints(report.recheckHints.requirements)
  );

  if (report.diagnostics.length > 0) {
    lines.push("", "Diagnostics:", ...formatDiagnosticsText(report.diagnostics));
  }

  if (report.changes.length === 0) {
    // 製図ソースが動いているのに "No semantic changes." だけを出すと「Loomit は何も見ていない」と読まれる。
    // 宣言と射影フィーチャの話であることを明示し、幾何を測る次の一手(Seamlint)へ渡す。
    const draftingNote = formatDraftingSourceNote(report.draftingSource);

    if (draftingNote !== undefined) {
      lines.push(
        "",
        "No changes to the declared structure (connectors, requirements, darts, notches).",
        ...draftingNote
      );
    } else {
      lines.push("", "No semantic changes.");
    }
  } else {
    lines.push("", "Changes:");

    for (const change of report.changes) {
      if (change.kind === "added") {
        lines.push(`  [added] ${change.feature} ${change.id}`);
        continue;
      }

      if (change.kind === "removed") {
        lines.push(`  [removed] ${change.feature} ${change.id}`);
        continue;
      }

      lines.push(`  [modified] ${change.feature} ${change.id}`);

      for (const fieldChange of change.changes) {
        lines.push(
          `    - ${fieldChange.field}: ${formatValue(fieldChange.before)} -> ${formatValue(fieldChange.after)}`
        );
      }
    }
  }

  if (report.relatedNotes.length > 0) {
    lines.push("", "Related Prototype Notes:");

    for (const note of report.relatedNotes) {
      lines.push(`  - ${note.id} (${note.result}, ${note.date})`);
      lines.push(`    issue: ${note.issue}`);
      // why 行が「なぜ関連するか」(前提タグ＋変わったフィーチャ)を一行にまとめるので、旧 tags 行は畳む。
      lines.push(`    why: ${formatNoteReasons(note.reasons)}`);
      lines.push(`    test case: ${note.createsTestCase}`);

      for (const suggestion of note.suggestedChange) {
        lines.push(`    suggested_change: ${suggestion}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function formatDraftingSource(draftingSource: NonNullable<PartDiffReport["draftingSource"]>): string {
  if (draftingSource.status === "added" || draftingSource.status === "removed") {
    return draftingSource.status;
  }

  if (draftingSource.status === "same") {
    return "same";
  }

  const count = draftingSource.changedParameters;

  return `changed (${count} ${count === 1 ? "parameter" : "parameters"})`;
}

// changes が空のときに "No semantic changes." で終わらせない説明。語ることが無ければ undefined。
// 状態ごとに文面を分ける ── 「製図が動いた」と「.val がこの版にはまだ無い(未コミット等)」を同じ文で出すと、
// 後者のときに作者が動いていない製図を疑いに行く。
function formatDraftingSourceNote(
  draftingSource: PartDiffReport["draftingSource"]
): readonly string[] | undefined {
  if (draftingSource === undefined || draftingSource.status === "same") {
    return undefined;
  }

  if (draftingSource.status === "added" || draftingSource.status === "removed") {
    // どちらの版に在るかは、出力冒頭の見出し(From: / To:)と同じ語で指す。"here" / "the other version" では
    // 読み手がどちらを見ればいいか決まらず、「.val が両方の版にあるか確認しろ」という次の行動に繋がらない。
    const direction =
      draftingSource.status === "added"
        ? "is present in the To version but not in the From version"
        : "is present in the From version but not in the To version";

    return [
      `The .val this part is drafted from ${direction}, so the drafting could not be compared.`,
      "Check files.source, or whether the .val is committed in both versions."
    ];
  }

  const count = draftingSource.changedParameters;

  // 「この part が変わった」とは書かない ── 1 つの .val を複数 part が共有するのが実データの形で、
  // どの part の製図が動いたかは Loomit には辿れない([C6])。言えるのは「下敷きの .val が動いた」まで。
  return [
    `The .val this part is drafted from moved (${count} ${count === 1 ? "parameter" : "parameters"}). Drafting formulas are geometry, which Loomit does not compute, and one .val is shared by several parts — this does not say the change landed on this part.`,
    "Run `loom slnt check` to measure what it did to the seams."
  ];
}

function formatNoteReasons(reasons: PartDiffReport["relatedNotes"][number]["reasons"]): string {
  const parts = reasons.map((reason) => {
    if (reason.kind === "applies-to-tags") {
      return `applies-to tags [${reason.tags.join(", ")}] (${reason.matchedOn})`;
    }

    if (reason.kind === "feature-overlap") {
      // regime レベルの一致より鋭い「この note は今回変えたこの部位の話」。どのタグで結び付いたかも見せる。
      return `touches ${reason.feature} [${reason.changedIds.join(", ")}] (via ${reason.matchedTags.join(", ")})`;
    }

    return `changed ${reason.feature} [${reason.changedIds.join(", ")}]`;
  });

  // 理由が空になることは無い想定(最低でも applies-to-tags が入る)だが、念のため中立表現を置く。
  return parts.length > 0 ? parts.join("; ") : "related";
}

function formatPartRoleHint(partRole: PartDiffReport["recheckHints"]["partRole"]): string {
  return partRole.changed ? `${partRole.from} -> ${partRole.to}` : partRole.from;
}

function formatConnectorHints(
  connectors: PartDiffReport["recheckHints"]["connectors"]
): readonly string[] {
  if (connectors.length === 0) {
    return ["  connectors: none"];
  }

  return [
    "  connectors:",
    ...connectors.map(
      (connector) => `    - ${connector.id} (${connector.changeKinds.join(", ")})`
    )
  ];
}

function formatRequirementHints(
  requirements: PartDiffReport["recheckHints"]["requirements"]
): readonly string[] {
  if (requirements.length === 0) {
    return ["  requirements: none"];
  }

  return ["  requirements:", ...requirements.map((requirement) => `    - ${requirement}`)];
}

function formatValue(value: boolean | number | string | readonly string[] | undefined): string {
  if (value === undefined) {
    return "<missing>";
  }

  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return String(value);
}
