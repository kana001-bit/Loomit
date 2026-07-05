import { createDiagnostic } from "../diagnostics/diagnostic.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { PrototypeNotes } from "../schema/prototype-notes.schema.js";
import type { Connector, Dart, Part, Requirement } from "../schema/part.schema.js";

export type PartDiffStatus = "same" | "changed" | "warning" | "error";

// 設計判断: decision summary は「この試作ブランチを残すか捨てるか」を素早く判断するための要約シグナルであり、
// 幾何レベルの厳密な変化量ではない。値は raw diff から導ける近似的な「気配」であって、正確な計測ではない。
export type SilhouetteImpact = "none" | "low" | "medium" | "high";
export type VolumeChange = "none" | "reduced" | "increased" | "mixed";
export type ConnectionRisk = "none" | "review-needed";
export type PrototypeNoteSignal = "none" | "related-notes-found";

export interface PartDiffDecisionSummary {
  // darts / gather の追加・寸法変更が、体に見える形をどれだけ動かしそうかの気配。
  readonly silhouetteImpact: SilhouetteImpact;
  // dart の width / intake が増えるとゆとりが減る(reduced)、減ると増える(increased)方向の気配。
  readonly volumeChange: VolumeChange;
  // connectors / requires が変わったら、縫い合わせ・適合の確認が要るという気配。
  readonly connectionRisk: ConnectionRisk;
  // この差分に関連する prototype note が見つかったかどうか。
  readonly prototypeNoteSignal: PrototypeNoteSignal;
}

export interface PartDiffFieldChange {
  readonly field: string;
  readonly before?: boolean | number | string | readonly string[];
  readonly after?: boolean | number | string | readonly string[];
}

export type PartDiffChange =
  | {
      readonly feature: "dart";
      readonly kind: "added";
      readonly id: string;
      readonly after: Dart;
    }
  | {
      readonly feature: "dart";
      readonly kind: "removed";
      readonly id: string;
      readonly before: Dart;
    }
  | {
      readonly feature: "dart";
      readonly kind: "modified";
      readonly id: string;
      readonly before: Dart;
      readonly after: Dart;
      readonly changes: readonly PartDiffFieldChange[];
    }
  | {
      readonly feature: "connector";
      readonly kind: "added";
      readonly id: string;
      readonly after: Connector;
    }
  | {
      readonly feature: "connector";
      readonly kind: "removed";
      readonly id: string;
      readonly before: Connector;
    }
  | {
      readonly feature: "connector";
      readonly kind: "modified";
      readonly id: string;
      readonly before: Connector;
      readonly after: Connector;
      readonly changes: readonly PartDiffFieldChange[];
    }
  | {
      readonly feature: "requirement";
      readonly kind: "added";
      readonly id: string;
      readonly after: Requirement;
    }
  | {
      readonly feature: "requirement";
      readonly kind: "removed";
      readonly id: string;
      readonly before: Requirement;
    }
  | {
      readonly feature: "requirement";
      readonly kind: "modified";
      readonly id: string;
      readonly before: Requirement;
      readonly after: Requirement;
      readonly changes: readonly PartDiffFieldChange[];
    };

export interface PartDiffReport {
  readonly status: PartDiffStatus;
  readonly decisionSummary: PartDiffDecisionSummary;
  readonly diagnostics: readonly Diagnostic[];
  readonly from: Pick<Part, "name" | "variant" | "type">;
  readonly to: Pick<Part, "name" | "variant" | "type">;
  readonly changes: readonly PartDiffChange[];
  readonly relatedNotes: readonly PartDiffPrototypeNoteMatch[];
}

export interface PartDiffPrototypeNoteMatch {
  readonly id: string;
  readonly date: string;
  readonly result: string;
  readonly issue: string;
  readonly appliesTo: readonly string[];
  readonly suggestedChange: readonly string[];
}

export function diffParts(
  from: Part,
  to: Part,
  options: {
    readonly prototypeNotes?: PrototypeNotes;
    // part load / darts 射影など、diff の前段で出た診断。status にも反映させるため取り込む。
    readonly inputDiagnostics?: readonly Diagnostic[];
  } = {}
): PartDiffReport {
  const diagnostics = [
    ...(options.inputDiagnostics ?? []),
    ...createPartDiffDiagnostics(from, to)
  ];
  const changes = [
    ...diffDarts(from.darts ?? {}, to.darts ?? {}),
    ...diffConnectors(from.connectors ?? {}, to.connectors ?? {}),
    ...diffRequirements(from.requires ?? {}, to.requires ?? {})
  ];
  const relatedNotes = findRelatedPrototypeNotes(from, to, options.prototypeNotes);
  const decisionSummary = buildDecisionSummary(changes, relatedNotes);

  return {
    status: getPartDiffStatus(diagnostics, changes),
    // 判断に効く要約を status の直後・詳細より前に置く。JSON でも後続ツールが最初に読める順にする。
    decisionSummary,
    diagnostics,
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
    changes,
    relatedNotes
  };
}

function createPartDiffDiagnostics(from: Part, to: Part): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (from.type !== to.type) {
    diagnostics.push(
      createDiagnostic({
        severity: "warning",
        code: "PART_DIFF_TYPE_CHANGED",
        message: `Comparing part type "${from.type}" to "${to.type}".`,
        suggestion: [
          "Compare parts with the same role/type when reviewing seam and silhouette changes."
        ]
      })
    );
  }

  if (from.name !== to.name) {
    diagnostics.push(
      createDiagnostic({
        severity: "warning",
        code: "PART_DIFF_NAME_CHANGED",
        message: `Comparing part name "${from.name}" to "${to.name}".`,
        suggestion: [
          "If this is meant to be the same evolving part, prefer keeping the base name stable and changing variant or feature fields."
        ]
      })
    );
  }

  return diagnostics;
}

function diffDarts(
  fromDarts: Readonly<Record<string, Dart>>,
  toDarts: Readonly<Record<string, Dart>>
): readonly PartDiffChange[] {
  const ids = new Set([...Object.keys(fromDarts), ...Object.keys(toDarts)]);
  const changes: PartDiffChange[] = [];

  for (const id of [...ids].sort()) {
    const before = fromDarts[id];
    const after = toDarts[id];

    if (before === undefined && after !== undefined) {
      changes.push({
        feature: "dart",
        kind: "added",
        id,
        after
      });
      continue;
    }

    if (before !== undefined && after === undefined) {
      changes.push({
        feature: "dart",
        kind: "removed",
        id,
        before
      });
      continue;
    }

    if (before === undefined || after === undefined) {
      continue;
    }

    const fieldChanges = diffDartFields(before, after);

    if (fieldChanges.length > 0) {
      changes.push({
        feature: "dart",
        kind: "modified",
        id,
        before,
        after,
        changes: fieldChanges
      });
    }
  }

  return changes;
}

function diffDartFields(before: Dart, after: Dart): readonly PartDiffFieldChange[] {
  const changes: PartDiffFieldChange[] = [];

  pushFieldChange(changes, "apex_ref", before.apex_ref, after.apex_ref);
  pushFieldChange(changes, "width_mm", before.width_mm, after.width_mm);
  pushFieldChange(changes, "width_formula", before.width_formula, after.width_formula);
  pushFieldChange(
    changes,
    "intake_length_mm",
    before.intake_length_mm,
    after.intake_length_mm
  );
  pushFieldChange(
    changes,
    "intake_length_formula",
    before.intake_length_formula,
    after.intake_length_formula
  );
  pushFieldChange(changes, "legs.left_ref", before.legs.left_ref, after.legs.left_ref);
  pushFieldChange(changes, "legs.right_ref", before.legs.right_ref, after.legs.right_ref);

  return changes;
}

function pushFieldChange(
  changes: PartDiffFieldChange[],
  field: PartDiffFieldChange["field"],
  before: boolean | number | string | readonly string[] | undefined,
  after: boolean | number | string | readonly string[] | undefined
): void {
  if (isSameDiffValue(before, after)) {
    return;
  }

  changes.push({
    field,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after })
  });
}

function isSameDiffValue(
  before: boolean | number | string | readonly string[] | undefined,
  after: boolean | number | string | readonly string[] | undefined
): boolean {
  if (before === after) {
    return true;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    return before.length === after.length && before.every((value, index) => value === after[index]);
  }

  return false;
}

function diffConnectors(
  fromConnectors: Readonly<Record<string, Connector>>,
  toConnectors: Readonly<Record<string, Connector>>
): readonly PartDiffChange[] {
  const ids = new Set([...Object.keys(fromConnectors), ...Object.keys(toConnectors)]);
  const changes: PartDiffChange[] = [];

  for (const id of [...ids].sort()) {
    const before = fromConnectors[id];
    const after = toConnectors[id];

    if (before === undefined && after !== undefined) {
      changes.push({
        feature: "connector",
        kind: "added",
        id,
        after
      });
      continue;
    }

    if (before !== undefined && after === undefined) {
      changes.push({
        feature: "connector",
        kind: "removed",
        id,
        before
      });
      continue;
    }

    if (before === undefined || after === undefined) {
      continue;
    }

    const fieldChanges = diffConnectorFields(before, after);

    if (fieldChanges.length > 0) {
      changes.push({
        feature: "connector",
        kind: "modified",
        id,
        before,
        after,
        changes: fieldChanges
      });
    }
  }

  return changes;
}

function diffConnectorFields(before: Connector, after: Connector): readonly PartDiffFieldChange[] {
  const changes: PartDiffFieldChange[] = [];

  pushFieldChange(changes, "type", before.type, after.type);
  pushFieldChange(changes, "length_mm", before.length_mm, after.length_mm);
  pushFieldChange(changes, "tolerance_mm", before.tolerance_mm, after.tolerance_mm);
  pushFieldChange(changes, "path_ref", before.path_ref, after.path_ref);

  const beforeRanges = indexConnectorRanges(before);
  const afterRanges = indexConnectorRanges(after);
  const rangeIds = new Set([...Object.keys(beforeRanges), ...Object.keys(afterRanges)]);

  for (const rangeId of [...rangeIds].sort()) {
    const beforeRange = beforeRanges[rangeId];
    const afterRange = afterRanges[rangeId];

    if (beforeRange === undefined && afterRange !== undefined) {
      pushFieldChange(changes, `ranges.${rangeId}`, undefined, formatRangeSummary(afterRange));
      continue;
    }

    if (beforeRange !== undefined && afterRange === undefined) {
      pushFieldChange(changes, `ranges.${rangeId}`, formatRangeSummary(beforeRange), undefined);
      continue;
    }

    if (beforeRange === undefined || afterRange === undefined) {
      continue;
    }

    pushFieldChange(changes, `ranges.${rangeId}.from`, beforeRange.from, afterRange.from);
    pushFieldChange(changes, `ranges.${rangeId}.to`, beforeRange.to, afterRange.to);
    pushFieldChange(
      changes,
      `ranges.${rangeId}.behavior`,
      beforeRange.behavior,
      afterRange.behavior
    );
    pushFieldChange(
      changes,
      `ranges.${rangeId}.allowance_mm`,
      beforeRange.allowance_mm,
      afterRange.allowance_mm
    );
  }

  return changes;
}

function diffRequirements(
  fromRequirements: Readonly<Record<string, Requirement>>,
  toRequirements: Readonly<Record<string, Requirement>>
): readonly PartDiffChange[] {
  const ids = new Set([...Object.keys(fromRequirements), ...Object.keys(toRequirements)]);
  const changes: PartDiffChange[] = [];

  for (const id of [...ids].sort()) {
    const before = fromRequirements[id];
    const after = toRequirements[id];

    if (before === undefined && after !== undefined) {
      changes.push({
        feature: "requirement",
        kind: "added",
        id,
        after
      });
      continue;
    }

    if (before !== undefined && after === undefined) {
      changes.push({
        feature: "requirement",
        kind: "removed",
        id,
        before
      });
      continue;
    }

    if (before === undefined || after === undefined) {
      continue;
    }

    const fieldChanges = diffRequirementFields(before, after);

    if (fieldChanges.length > 0) {
      changes.push({
        feature: "requirement",
        kind: "modified",
        id,
        before,
        after,
        changes: fieldChanges
      });
    }
  }

  return changes;
}

function diffRequirementFields(
  before: Requirement,
  after: Requirement
): readonly PartDiffFieldChange[] {
  const changes: PartDiffFieldChange[] = [];

  pushFieldChange(changes, "min", before.min, after.min);
  pushFieldChange(changes, "max", before.max, after.max);
  pushFieldChange(changes, "equals", before.equals, after.equals);
  pushFieldChange(
    changes,
    "includes",
    normalizeStringArray(before.includes),
    normalizeStringArray(after.includes)
  );

  return changes;
}

function normalizeStringArray(value: readonly string[] | undefined): readonly string[] | undefined {
  return value === undefined ? undefined : [...value].sort();
}

function indexConnectorRanges(
  connector: Connector
): Readonly<
  Record<
    string,
    {
      readonly from: number;
      readonly to: number;
      readonly behavior: string;
      readonly allowance_mm?: number;
    }
  >
> {
  const ranges: Record<
    string,
    {
      readonly from: number;
      readonly to: number;
      readonly behavior: string;
      readonly allowance_mm?: number;
    }
  > = {};

  for (const range of connector.ranges ?? []) {
    ranges[range.id] = {
      from: range.from,
      to: range.to,
      behavior: range.behavior,
      ...(range.allowance_mm === undefined ? {} : { allowance_mm: range.allowance_mm })
    };
  }

  return ranges;
}

function formatRangeSummary(range: {
  readonly from: number;
  readonly to: number;
  readonly behavior: string;
  readonly allowance_mm?: number;
}): string {
  return `from=${range.from}, to=${range.to}, behavior=${range.behavior}, allowance_mm=${range.allowance_mm ?? "<missing>"}`;
}

function getPartDiffStatus(
  diagnostics: readonly Diagnostic[],
  changes: readonly PartDiffChange[]
): PartDiffStatus {
  const hasError = diagnostics.some((diagnostic) => diagnostic.severity === "error");

  if (hasError) {
    return "error";
  }

  const hasWarning = diagnostics.some((diagnostic) => diagnostic.severity === "warning");

  if (hasWarning) {
    return "warning";
  }

  return changes.length > 0 ? "changed" : "same";
}

function findRelatedPrototypeNotes(
  from: Part,
  to: Part,
  prototypeNotes: PrototypeNotes | undefined
): readonly PartDiffPrototypeNoteMatch[] {
  if (prototypeNotes === undefined) {
    return [];
  }

  const fromTags = new Set(from.tags ?? []);
  const toTags = new Set(to.tags ?? []);

  return prototypeNotes.notes.flatMap((note) => {
    if (note.applies_to === undefined) {
      return [];
    }

    const matchesFrom = note.applies_to.every((tag) => fromTags.has(tag));
    const matchesTo = note.applies_to.every((tag) => toTags.has(tag));

    if (!matchesFrom && !matchesTo) {
      return [];
    }

    return [
      {
        id: note.id,
        date: note.date,
        result: note.result,
        issue: note.issue,
        appliesTo: [...note.applies_to],
        suggestedChange: [...(note.suggested_change ?? [])]
      }
    ];
  });
}

const silhouetteImpactRank: Readonly<Record<SilhouetteImpact, number>> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3
};

const silhouetteImpactByRank: readonly SilhouetteImpact[] = ["none", "low", "medium", "high"];

// dart の成形量(布をつまむ量)を左右するフィールド。ここが動くと volume/silhouette の気配が上がる。
const dartShapingAmountFields: ReadonlySet<string> = new Set([
  "width_mm",
  "width_formula",
  "intake_length_mm",
  "intake_length_formula"
]);

function buildDecisionSummary(
  changes: readonly PartDiffChange[],
  relatedNotes: readonly PartDiffPrototypeNoteMatch[]
): PartDiffDecisionSummary {
  return {
    silhouetteImpact: getSilhouetteImpact(changes),
    volumeChange: getVolumeChange(changes),
    connectionRisk: getConnectionRisk(changes),
    prototypeNoteSignal: relatedNotes.length > 0 ? "related-notes-found" : "none"
  };
}

// darts と gather range の変化を、体に見える形の変化として集約する。add/remove を最も強い気配とみなす。
function getSilhouetteImpact(changes: readonly PartDiffChange[]): SilhouetteImpact {
  let rank = 0;

  for (const change of changes) {
    rank = Math.max(rank, silhouetteImpactRank[silhouetteImpactOf(change)]);
  }

  // rank は 0..3 のいずれかなので必ず引ける。noUncheckedIndexedAccess のため fallback を置く。
  return silhouetteImpactByRank[rank] ?? "none";
}

function silhouetteImpactOf(change: PartDiffChange): SilhouetteImpact {
  if (change.feature === "dart") {
    if (change.kind === "added" || change.kind === "removed") {
      return "high";
    }

    return change.changes.some((fieldChange) => dartShapingAmountFields.has(fieldChange.field))
      ? "medium"
      : "low";
  }

  if (change.feature === "connector" && connectorChangeTouchesGather(change)) {
    return "medium";
  }

  return "none";
}

// gather = ranges.behavior === "gathered"。gather の増減や寸法変更だけを silhouette の気配に数える。
// ease など他 behavior の range は形ではなく接続の話なので、connectionRisk 側で拾う。
function connectorChangeTouchesGather(
  change: Extract<PartDiffChange, { readonly feature: "connector" }>
): boolean {
  if (change.kind === "added") {
    return hasGatheredRange(change.after);
  }

  if (change.kind === "removed") {
    return hasGatheredRange(change.before);
  }

  const gatheredIds = new Set([
    ...gatheredRangeIds(change.before),
    ...gatheredRangeIds(change.after)
  ]);

  if (gatheredIds.size === 0) {
    return false;
  }

  return change.changes.some((fieldChange) => {
    if (!fieldChange.field.startsWith("ranges.")) {
      return false;
    }

    // field は "ranges.<id>" か "ranges.<id>.<sub>"。<id> を取り出して gather かどうか照合する。
    const rangeId = fieldChange.field.split(".")[1];

    return rangeId !== undefined && gatheredIds.has(rangeId);
  });
}

function hasGatheredRange(connector: Connector): boolean {
  return (connector.ranges ?? []).some((range) => range.behavior === "gathered");
}

function gatheredRangeIds(connector: Connector): ReadonlySet<string> {
  return new Set(
    (connector.ranges ?? [])
      .filter((range) => range.behavior === "gathered")
      .map((range) => range.id)
  );
}

// 設計判断: dart は布をつまんで除く成形なので、width/intake が増える = 除く布が増える = ゆとりが減る(reduced)。
// 減る = ゆとりが増える(increased)。dart 追加は reduced、削除は increased。
// 方向が読めない formula 変更は volume に数えない(幾何評価は別スコープ)。gather も今回は silhouette のみに数える。
function getVolumeChange(changes: readonly PartDiffChange[]): VolumeChange {
  let hasReduced = false;
  let hasIncreased = false;

  for (const change of changes) {
    if (change.feature !== "dart") {
      continue;
    }

    if (change.kind === "added") {
      hasReduced = true;
      continue;
    }

    if (change.kind === "removed") {
      hasIncreased = true;
      continue;
    }

    for (const fieldChange of change.changes) {
      if (fieldChange.field !== "width_mm" && fieldChange.field !== "intake_length_mm") {
        continue;
      }

      const before = numericValue(fieldChange.before);
      const after = numericValue(fieldChange.after);

      if (before === undefined || after === undefined || before === after) {
        continue;
      }

      if (after > before) {
        hasReduced = true;
      } else {
        hasIncreased = true;
      }
    }
  }

  if (hasReduced && hasIncreased) {
    return "mixed";
  }

  if (hasReduced) {
    return "reduced";
  }

  return hasIncreased ? "increased" : "none";
}

function numericValue(
  value: boolean | number | string | readonly string[] | undefined
): number | undefined {
  return typeof value === "number" ? value : undefined;
}

// connectors / requires の変更は縫い合わせ・適合条件に効きうるため、後続の厳密チェック要という気配を立てる。
function getConnectionRisk(changes: readonly PartDiffChange[]): ConnectionRisk {
  return changes.some(
    (change) => change.feature === "connector" || change.feature === "requirement"
  )
    ? "review-needed"
    : "none";
}
