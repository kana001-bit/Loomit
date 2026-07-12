import { createDiagnostic } from "../diagnostics/diagnostic.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { indexConnectorRanges } from "../schema/connectorRanges.js";
import type { PrototypeNotes } from "../schema/prototype-notes.schema.js";
import type { Connector, Dart, Notch, Part, Requirement } from "../schema/part.schema.js";

export type PartDiffStatus = "same" | "changed" | "warning" | "error";

// 設計判断: decision summary は「この試作ブランチを残すか捨てるか」を素早く判断するための要約シグナルであり、
// 幾何レベルの厳密な変化量ではない。値は raw diff から導ける近似的な「気配」であって、正確な計測ではない。
export type SilhouetteImpact = "none" | "low" | "medium" | "high";
export type VolumeChange = "none" | "reduced" | "increased" | "mixed";
export type ConnectionRisk = "none" | "review-needed";
export type PrototypeNoteSignal = "none" | "related-notes-found";
export type PartDiffConnectorRecheckKind =
  | "added"
  | "removed"
  | "type"
  | "length"
  | "tolerance"
  | "path"
  // side = 縫い目でこのピースがどちらの unit(側)かの変更。stacked↔contiguous や側の付け替えは assembly の
  // 意味を変える(check の役割② / Seamlint の和の測定に効く)ので、recheck hint に載せる。
  | "side"
  | "gathered-range"
  | "range";

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

export interface PartDiffConnectorRecheckHint {
  readonly id: string;
  readonly changeKinds: readonly PartDiffConnectorRecheckKind[];
}

export interface PartDiffRecheckHints {
  // Design decision: diff compares the part role/type axis stored in `Part.type`.
  // Keep the handoff wording "part role" while reusing Loomit's existing field instead of inventing another role key.
  readonly partRole: {
    readonly from: string;
    readonly to: string;
    readonly changed: boolean;
  };
  readonly connectors: readonly PartDiffConnectorRecheckHint[];
  readonly requirements: readonly string[];
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
      readonly feature: "notch";
      readonly kind: "added";
      readonly id: string;
      readonly after: Notch;
    }
  | {
      readonly feature: "notch";
      readonly kind: "removed";
      readonly id: string;
      readonly before: Notch;
    }
  | {
      readonly feature: "notch";
      readonly kind: "modified";
      readonly id: string;
      readonly before: Notch;
      readonly after: Notch;
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
  readonly recheckHints: PartDiffRecheckHints;
  readonly diagnostics: readonly Diagnostic[];
  readonly from: Pick<Part, "name" | "variant" | "type">;
  readonly to: Pick<Part, "name" | "variant" | "type">;
  readonly changes: readonly PartDiffChange[];
  readonly relatedNotes: readonly PartDiffPrototypeNoteMatch[];
}

// 設計判断: prototype note と差分の間に id レベルの構造リンクは無い(note は applies_to タグと
// creates_test_case しか差分に接続できない)。そこで「なぜ今回の差分に関連するか」を、発明した幾何意味では
// なく、実際に読める事実だけで説明する: (1) note の設計前提タグが今も成立している、(2) その前提下で
// 実際にフィーチャが変わった。この2つを reason として持たせ、判断材料を透明にする。
export type PartDiffPrototypeNoteReason =
  | {
      readonly kind: "applies-to-tags";
      // note.applies_to のうち part のタグと一致した設計前提タグ。regime が今も成立している根拠。
      readonly tags: readonly string[];
      // from / to / both のどの revision で前提が成立したか。
      readonly matchedOn: "from" | "to" | "both";
    }
  | {
      readonly kind: "changed-feature";
      // 今回の差分で変わったフィーチャ種別。note を読み返す価値がある「変化があった」根拠。
      readonly feature: PartDiffChange["feature"];
      readonly changedIds: readonly string[];
    }
  | {
      // regime レベルの一致(applies-to-tags)より狭く、「この note は今回変えた“この部位”の話らしい」を指す。
      // 変わったフィーチャの id と note の applies_to タグを、名前トークンで突き合わせて重なったものだけを載せる
      // (例: 変更 connector "armhole" ↔ タグ "fitted-armhole" は "armhole" で重なる)。当てずっぽうにせず、
      // どのタグで結び付いたか(matchedTags)を残す。この理由を持つ note は related の上位に並べる。
      readonly kind: "feature-overlap";
      readonly feature: PartDiffChange["feature"];
      readonly changedIds: readonly string[];
      readonly matchedTags: readonly string[];
    };

export interface PartDiffPrototypeNoteMatch {
  readonly id: string;
  readonly date: string;
  readonly result: string;
  readonly issue: string;
  readonly appliesTo: readonly string[];
  readonly suggestedChange: readonly string[];
  // schema 上 applies_to と対で必ず存在する movement test。差分後に再走行すべき試験の手がかり。
  readonly createsTestCase: string;
  // この note が今回の差分に関連する根拠。tag 一致(regime)＋変わったフィーチャ種別。
  readonly reasons: readonly PartDiffPrototypeNoteReason[];
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
    ...diffNotches(from.notches ?? {}, to.notches ?? {}),
    ...diffConnectors(from.connectors ?? {}, to.connectors ?? {}),
    ...diffRequirements(from.requires ?? {}, to.requires ?? {})
  ];
  const relatedNotes = findRelatedPrototypeNotes(from, to, changes, options.prototypeNotes);
  const decisionSummary = buildDecisionSummary(changes, relatedNotes);
  const recheckHints = buildRecheckHints(from, to, changes);

  return {
    status: getPartDiffStatus(diagnostics, changes),
    // 判断に効く要約を status の直後・詳細より前に置く。JSON でも後続ツールが最初に読める順にする。
    decisionSummary,
    recheckHints,
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

function diffNotches(
  fromNotches: Readonly<Record<string, Notch>>,
  toNotches: Readonly<Record<string, Notch>>
): readonly PartDiffChange[] {
  const ids = new Set([...Object.keys(fromNotches), ...Object.keys(toNotches)]);
  const changes: PartDiffChange[] = [];

  for (const id of [...ids].sort()) {
    const before = fromNotches[id];
    const after = toNotches[id];

    if (before === undefined && after !== undefined) {
      changes.push({
        feature: "notch",
        kind: "added",
        id,
        after
      });
      continue;
    }

    if (before !== undefined && after === undefined) {
      changes.push({
        feature: "notch",
        kind: "removed",
        id,
        before
      });
      continue;
    }

    if (before === undefined || after === undefined) {
      continue;
    }

    const fieldChanges = diffNotchFields(before, after);

    if (fieldChanges.length > 0) {
      changes.push({
        feature: "notch",
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

function diffNotchFields(before: Notch, after: Notch): readonly PartDiffFieldChange[] {
  const changes: PartDiffFieldChange[] = [];

  pushFieldChange(changes, "seam_ref", before.seam_ref, after.seam_ref);
  pushFieldChange(changes, "piece", before.piece, after.piece);
  pushFieldChange(changes, "position", before.position, after.position);
  pushFieldChange(changes, "type", before.type, after.type);
  pushFieldChange(changes, "angle", before.angle, after.angle);
  pushFieldChange(changes, "depth_mm", before.depth_mm, after.depth_mm);
  pushFieldChange(changes, "width_mm", before.width_mm, after.width_mm);
  // 設計判断: order は DXF 突き合わせ用の構造キー(piece 内の並び順)であって人が直接いじる編集フィーチャでは
  // ないため diff しない。合印を1つ挿入/削除すると後続の order が繰り上がる「番号ズレ」で全 notch が modified
  // に見えるノイズを避ける(追加・削除そのものは added/removed で出るので取りこぼさない)。

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
  // side(所属 unit)の変更は assembly の意味を変えるので diff に載せる(recheck hint は side kind に写す)。
  pushFieldChange(changes, "side", before.side, after.side);

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
    pushFieldChange(
      changes,
      `ranges.${rangeId}.ease_ratio_min`,
      beforeRange.ease_ratio_min,
      afterRange.ease_ratio_min
    );
    pushFieldChange(
      changes,
      `ranges.${rangeId}.ease_ratio_max`,
      beforeRange.ease_ratio_max,
      afterRange.ease_ratio_max
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

function formatRangeSummary(range: {
  readonly from: number;
  readonly to: number;
  readonly behavior: string;
  readonly allowance_mm?: number;
  readonly ease_ratio_min?: number;
  readonly ease_ratio_max?: number;
}): string {
  const easeBand =
    range.ease_ratio_min === undefined || range.ease_ratio_max === undefined
      ? "<missing>"
      : `[${range.ease_ratio_min}, ${range.ease_ratio_max}]`;
  return `from=${range.from}, to=${range.to}, behavior=${range.behavior}, allowance_mm=${range.allowance_mm ?? "<missing>"}, ease_ratio=${easeBand}`;
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
  changes: readonly PartDiffChange[],
  prototypeNotes: PrototypeNotes | undefined
): readonly PartDiffPrototypeNoteMatch[] {
  if (prototypeNotes === undefined) {
    return [];
  }

  // 何も変わっていない差分に過去メモを並べても「この変更が過去とどう関わるか」の判断材料にならない。
  // note は今回変わったフィーチャに紐づけて初めて related とみなす(タグが付いているだけでは出さない)。
  if (changes.length === 0) {
    return [];
  }

  const fromTags = new Set(from.tags ?? []);
  const toTags = new Set(to.tags ?? []);
  // regime レベルの「何が変わったか」は差分ごとに同一なので一度だけ組み立て、重なりが無い note で共有する。
  const changedFeatureReasons = buildChangedFeatureReasons(changes);

  const matches = prototypeNotes.notes.flatMap((note) => {
    // applies_to と creates_test_case は schema 上つねに対で存在するが、片方でも欠ける不正データは
    // related に載せない(createsTestCase を確定した string として扱えるようにする防御)。
    if (note.applies_to === undefined || note.creates_test_case === undefined) {
      return [];
    }

    const matchesFrom = note.applies_to.every((tag) => fromTags.has(tag));
    const matchesTo = note.applies_to.every((tag) => toTags.has(tag));

    if (!matchesFrom && !matchesTo) {
      return [];
    }

    const appliesToReason: PartDiffPrototypeNoteReason = {
      kind: "applies-to-tags",
      tags: [...note.applies_to],
      matchedOn: matchesFrom && matchesTo ? "both" : matchesFrom ? "from" : "to"
    };

    // この note の applies_to タグと、変わったフィーチャの id を名前トークンで突き合わせる。重なりが
    // あれば「この note は今回変えたこの部位の話」= feature-overlap を出し、regime レベルの changed-feature は
    // 冗長なので載せない(狭い方が説明として鋭い)。重なりが無ければ従来どおり changed-feature を残す。
    const featureOverlapReasons = buildFeatureOverlapReasons(changes, note.applies_to);
    const reasons =
      featureOverlapReasons.length > 0
        ? [appliesToReason, ...featureOverlapReasons]
        : [appliesToReason, ...changedFeatureReasons];

    return [
      {
        id: note.id,
        date: note.date,
        result: note.result,
        issue: note.issue,
        appliesTo: [...note.applies_to],
        suggestedChange: [...(note.suggested_change ?? [])],
        createsTestCase: note.creates_test_case,
        reasons
      }
    ];
  });

  // 今回の変更を直接触る(feature-overlap がある)note を上位に、regime だけの一致を下位に並べる。
  // 重み(重なった changed id の数)の降順・安定ソートで、同じ重みの note は定義順を保つ。
  return [...matches].sort(
    (left, right) => featureOverlapWeight(right) - featureOverlapWeight(left)
  );
}

// related note の並び替え用の重み。feature-overlap 理由が結び付けた changed id の総数。0 なら regime のみ。
function featureOverlapWeight(match: PartDiffPrototypeNoteMatch): number {
  return match.reasons.reduce(
    (sum, reason) => (reason.kind === "feature-overlap" ? sum + reason.changedIds.length : sum),
    0
  );
}

// 変わったフィーチャの id と note の applies_to タグを名前トークンで突き合わせ、重なったフィーチャを
// feature-overlap 理由にする。トークンは英数の連なり単位(部分文字列ではない)なので、"armhole" は
// "fitted-armhole" と重なるが "arm" では重ならない(誤検出を抑える)。matchedTags には結び付いたタグを残す。
function buildFeatureOverlapReasons(
  changes: readonly PartDiffChange[],
  appliesTo: readonly string[]
): readonly PartDiffPrototypeNoteReason[] {
  const tagTokens = new Set(appliesTo.flatMap(tokenize));

  if (tagTokens.size === 0) {
    return [];
  }

  // フィーチャ種別ごとに、重なった changed id と「重なりを生んだトークン」を別々に貯める。matchedTags を
  // 全フィーチャ共通で作ると、別のタグで重なった他フィーチャのタグまで各理由に載って誤解を招くため、
  // トークンもフィーチャ単位で持ち、そのフィーチャを結び付けたタグだけを reason に載せる。
  const overlapByFeature = new Map<
    PartDiffChange["feature"],
    { readonly ids: Set<string>; readonly tokens: Set<string> }
  >();

  for (const change of changes) {
    const hitTokens = tokenize(change.id).filter((token) => tagTokens.has(token));

    if (hitTokens.length === 0) {
      continue;
    }

    const entry = overlapByFeature.get(change.feature) ?? {
      ids: new Set<string>(),
      tokens: new Set<string>()
    };
    entry.ids.add(change.id);
    for (const token of hitTokens) {
      entry.tokens.add(token);
    }
    overlapByFeature.set(change.feature, entry);
  }

  if (overlapByFeature.size === 0) {
    return [];
  }

  const featureOrder: readonly PartDiffChange["feature"][] = [
    "dart",
    "notch",
    "connector",
    "requirement"
  ];

  return featureOrder.flatMap((feature) => {
    const entry = overlapByFeature.get(feature);

    if (entry === undefined) {
      return [];
    }

    // このフィーチャの重なりを生んだトークンを含む note タグだけを matchedTags にする。
    const matchedTags = [
      ...new Set(
        appliesTo.filter((tag) => tokenize(tag).some((token) => entry.tokens.has(token)))
      )
    ].sort();

    return [
      {
        kind: "feature-overlap" as const,
        feature,
        changedIds: [...entry.ids].sort(),
        matchedTags
      }
    ];
  });
}

// 名前を「文字/数字の連なり」単位のトークンに割る(小文字化)。区切りは Unicode の非英数字なので、日本語など
// 非 ASCII のタグ/id もトークンになる(schema は applies_to / connector id / requirement id に任意の非空文字列を
// 許すため、ASCII だけに絞ると日本語入力で feature-overlap が黙って発火しなくなる)。部分文字列ではなく
// トークン一致なので、"armhole" は "fitted-armhole" と重なるが "arm" では重ならない。
// 例: "fitted-armhole" → ["fitted","armhole"]、"フィット-袖ぐり" → ["フィット","袖ぐり"]。
function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

// 差分で変わったフィーチャを種別ごとにまとめ、related note の「変化があった」根拠にする。
// 種別は安定順(dart→connector→requirement)・id は昇順で並べ、出力とテストを決定的にする。
function buildChangedFeatureReasons(
  changes: readonly PartDiffChange[]
): readonly PartDiffPrototypeNoteReason[] {
  const idsByFeature = new Map<PartDiffChange["feature"], Set<string>>();

  for (const change of changes) {
    const ids = idsByFeature.get(change.feature) ?? new Set<string>();
    ids.add(change.id);
    idsByFeature.set(change.feature, ids);
  }

  const featureOrder: readonly PartDiffChange["feature"][] = [
    "dart",
    "notch",
    "connector",
    "requirement"
  ];

  return featureOrder.flatMap((feature) => {
    const ids = idsByFeature.get(feature);

    if (ids === undefined) {
      return [];
    }

    return [
      {
        kind: "changed-feature" as const,
        feature,
        changedIds: [...ids].sort()
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

// connectors / requires / notches の変更は縫い合わせ・適合に効きうるため、後続の厳密チェック要という気配を立てる。
// notch(合印)は縫い合わせの位置合わせそのものなので、追加・削除・移動(position)・付け替え(seam_ref)・ピース移動
// (piece)・種別(type)はすべて接続確認の対象にする。ただし depth_mm / width_mm / angle だけの変更は「合印をどれだけ
// 深く/広く/どの向きに入れるか」という縫いやすさ・見た目の param であって、辺が合うか(接続整合)は変えないため、
// connectionRisk は立てない(誤検知を避ける)。
function getConnectionRisk(changes: readonly PartDiffChange[]): ConnectionRisk {
  return changes.some((change) => {
    if (change.feature === "connector" || change.feature === "requirement") {
      return true;
    }

    if (change.feature === "notch") {
      return notchChangeAffectsConnection(change);
    }

    return false;
  })
    ? "review-needed"
    : "none";
}

// 設計判断: notch の追加・削除は常に接続確認の対象。変更は接続に効くフィールド(seam_ref/piece/position/type)が
// 動いたときだけ数え、深さ/幅/向き(depth_mm/width_mm/angle)だけの変更は縫いやすさ・見た目の調整なので接続確認から外す。
function notchChangeAffectsConnection(
  change: Extract<PartDiffChange, { readonly feature: "notch" }>
): boolean {
  if (change.kind !== "modified") {
    return true;
  }

  const sewabilityOnlyFields: ReadonlySet<string> = new Set(["depth_mm", "width_mm", "angle"]);

  return change.changes.some((fieldChange) => !sewabilityOnlyFields.has(fieldChange.field));
}

function buildRecheckHints(
  from: Pick<Part, "type">,
  to: Pick<Part, "type">,
  changes: readonly PartDiffChange[]
): PartDiffRecheckHints {
  const requirementIds = new Set<string>();
  const connectorHints: PartDiffConnectorRecheckHint[] = [];

  for (const change of changes) {
    if (change.feature === "requirement") {
      requirementIds.add(change.id);
      continue;
    }

    if (change.feature === "connector") {
      connectorHints.push({
        id: change.id,
        changeKinds: buildConnectorRecheckKinds(change)
      });
    }
  }

  return {
    partRole: {
      from: from.type,
      to: to.type,
      changed: from.type !== to.type
    },
    connectors: connectorHints,
    requirements: [...requirementIds].sort()
  };
}

const connectorRecheckKindOrder: readonly PartDiffConnectorRecheckKind[] = [
  "added",
  "removed",
  "type",
  "length",
  "tolerance",
  "path",
  "side",
  "gathered-range",
  "range"
];

function buildConnectorRecheckKinds(
  change: Extract<PartDiffChange, { readonly feature: "connector" }>
): readonly PartDiffConnectorRecheckKind[] {
  const kinds = new Set<PartDiffConnectorRecheckKind>();

  if (change.kind === "added") {
    kinds.add("added");
    addConnectorRangeKinds(kinds, change.after);
    return orderedConnectorRecheckKinds(kinds);
  }

  if (change.kind === "removed") {
    kinds.add("removed");
    addConnectorRangeKinds(kinds, change.before);
    return orderedConnectorRecheckKinds(kinds);
  }

  for (const fieldChange of change.changes) {
    if (fieldChange.field === "type") {
      kinds.add("type");
      continue;
    }

    if (fieldChange.field === "length_mm") {
      kinds.add("length");
      continue;
    }

    if (fieldChange.field === "tolerance_mm") {
      kinds.add("tolerance");
      continue;
    }

    if (fieldChange.field === "path_ref") {
      kinds.add("path");
      continue;
    }

    if (fieldChange.field === "side") {
      kinds.add("side");
      continue;
    }
  }

  addConnectorModifiedRangeKinds(kinds, change);

  return orderedConnectorRecheckKinds(kinds);
}

function orderedConnectorRecheckKinds(
  kinds: ReadonlySet<PartDiffConnectorRecheckKind>
): readonly PartDiffConnectorRecheckKind[] {
  return connectorRecheckKindOrder.filter((kind) => kinds.has(kind));
}

function addConnectorRangeKinds(
  kinds: Set<PartDiffConnectorRecheckKind>,
  connector: Connector
): void {
  const ranges = connector.ranges ?? [];

  if (ranges.some((range) => range.behavior === "gathered")) {
    kinds.add("gathered-range");
  }

  if (ranges.some((range) => range.behavior !== "gathered")) {
    kinds.add("range");
  }
}

function addConnectorModifiedRangeKinds(
  kinds: Set<PartDiffConnectorRecheckKind>,
  change: Extract<PartDiffChange, { readonly feature: "connector"; readonly kind: "modified" }>
): void {
  const changedGatheredRangeIds = new Set([
    ...gatheredRangeIds(change.before),
    ...gatheredRangeIds(change.after)
  ]);

  for (const fieldChange of change.changes) {
    if (!fieldChange.field.startsWith("ranges.")) {
      continue;
    }

    const rangeId = fieldChange.field.split(".")[1];

    if (rangeId !== undefined && changedGatheredRangeIds.has(rangeId)) {
      kinds.add("gathered-range");
      continue;
    }

    kinds.add("range");
  }
}
