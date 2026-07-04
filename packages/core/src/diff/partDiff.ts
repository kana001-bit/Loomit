import { createDiagnostic } from "../diagnostics/diagnostic.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { PrototypeNotes } from "../schema/prototype-notes.schema.js";
import type { Connector, Dart, Part, Requirement } from "../schema/part.schema.js";

export type PartDiffStatus = "same" | "changed" | "warning" | "error";

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

  return {
    status: getPartDiffStatus(diagnostics, changes),
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
