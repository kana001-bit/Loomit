import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { ResolvedProject, ResolvedProjectPart } from "../project/resolveParts.js";
import { resolveJoinedConnectorToleranceMm } from "../schema/connectorTolerance.js";
import { indexConnectorRanges } from "../schema/connectorRanges.js";
import type { Connector } from "../schema/part.schema.js";

export type SeamlintJoinKind =
  | "smooth-continuation"
  | "sewn-seam"
  | "closed-loop"
  | "overlap"
  | "intentional-corner"
  | "eased-seam"
  | "gathered-seam";

// Seamlint に渡す幾何ソースの種別。測定用の DXF(files.geometry)と視覚用の SVG(files.preview)を区別する。
export type SeamlintGeometrySourceFormat = "svg" | "dxf";

export interface SeamlintGeometryTarget {
  readonly partId: string;
  readonly pathRef: string;
  readonly connectorId?: string;
}

export interface SeamlintGeometryTolerance {
  readonly lengthMm?: number;
  readonly length_mm?: number;
  readonly endpointMm?: number;
  readonly endpoint_mm?: number;
  readonly tangentDeg?: number;
  readonly tangent_deg?: number;
  readonly angleDeg?: number;
  readonly angle_deg?: number;
  readonly easeRatio?: readonly [number, number];
  readonly ease_ratio?: readonly [number, number];
  readonly gatherRatio?: readonly [number, number];
  readonly gather_ratio?: readonly [number, number];
}

export interface SeamlintGeometryMarkerRef {
  readonly pathRef: string;
  readonly position: number;
}

export interface SeamlintGeometryMarkerRange {
  readonly startMarker?: string;
  readonly endMarker?: string;
  readonly start_marker?: string;
  readonly end_marker?: string;
}

export interface SeamlintGeometryCheckRange {
  readonly from: SeamlintGeometryMarkerRange;
  readonly to: SeamlintGeometryMarkerRange;
}

export interface SeamlintGeometryCheckSpec {
  readonly id: string;
  readonly kind: SeamlintJoinKind;
  readonly from: SeamlintGeometryTarget;
  readonly to?: SeamlintGeometryTarget;
  readonly tolerance?: SeamlintGeometryTolerance;
  readonly range?: SeamlintGeometryCheckRange;
}

export interface SeamlintGeometryPartRef {
  readonly partId: string;
  readonly geometrySource: string;
  readonly format: SeamlintGeometrySourceFormat;
  readonly unit: "mm";
  readonly scale: 1;
  readonly paths: Readonly<Record<string, string>>;
  readonly markers?: Readonly<Record<string, SeamlintGeometryMarkerRef>>;
  // 測定用ソースの本文を inline で持つ(materializeSeamlintGeometry が埋める)。self-contained に
  // することで、Seamlint を subprocess で呼ぶとき相手に filesystem access を要求しなくて済む。
  readonly geometryText?: string;
}

export interface SeamlintGeometryCheckRequest {
  readonly projectRoot?: string;
  readonly parts: readonly SeamlintGeometryPartRef[];
  readonly checks: readonly SeamlintGeometryCheckSpec[];
}

export interface SeamlintGeometryRequestBuildResult {
  readonly request: SeamlintGeometryCheckRequest;
  readonly diagnostics: readonly Diagnostic[];
}

interface MutableGeometryPartRef {
  partId: string;
  geometrySource: string;
  format: SeamlintGeometrySourceFormat;
  unit: "mm";
  scale: 1;
  paths: Record<string, string>;
  markers: Record<string, SeamlintGeometryMarkerRef>;
}

// 1つの join に参加している part と、その part がその join で宣言している connector をまとめて持つ。
// collectPartsByJoinId が connector も一緒に返すことで、下流で connectors[joinId] を引き直す必要が
// なくなり(= 常に定義済み)、到達しない undefined ガードを置かずに済む。
interface JoinParticipant {
  readonly part: ResolvedProjectPart;
  readonly connector: Connector;
}

// 解決済みの seam の片側。map への commit に必要な最小限だけを持つ。resolve(検証)と commit(mutation)を
// 分けることで、相手側が失敗したときに片側だけ geometryParts へ書き込んで孤立させることを防ぐ。
interface ResolvedGeometrySide {
  readonly role: string;
  readonly connectorId: string;
  readonly pathRef: string;
  readonly geometrySource: string;
  readonly format: SeamlintGeometrySourceFormat;
}

// part の測定用ソースを1つに決める。測定用 DXF(files.geometry)を優先し、無ければ視覚用 SVG
// (files.preview)にフォールバックする。format はソースの拡張子から導く(.dxf なら dxf、他は svg)。
interface ResolvedPartGeometry {
  readonly geometrySource: string;
  readonly format: SeamlintGeometrySourceFormat;
}

export function createSeamlintGeometryRequest(
  resolvedProject: ResolvedProject
): SeamlintGeometryRequestBuildResult {
  const diagnostics: Diagnostic[] = [];
  const geometryParts = new Map<string, MutableGeometryPartRef>();
  const checks: SeamlintGeometryCheckSpec[] = [];
  // part.role -> 解決済みソース / null(ソース欠落を既に警告済み)。geometry/preview は part 単位の
  // プロパティなので、その part が複数の join に参加していても欠落警告は1度だけにする。
  const partSourceCache = new Map<string, ResolvedPartGeometry | null>();

  for (const [joinId, participants] of collectPartsByJoinId(resolvedProject)) {
    // connector id を共有する part がちょうど2つでない場合は、黙って捨てず理由を診断で示す。
    // loom check の connector-pairing と同じ状況を、slnt request 単独実行でも取りこぼさない。
    if (participants.length === 1) {
      const only = participants[0];
      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: "SEAMLINT_CONNECTOR_JOIN_OPEN",
          message:
            `Connector "${joinId}" is declared only by "${only?.part.role ?? "one part"}", so there is no second side to build a Seamlint seam request from yet.`,
          target: `${only?.part.role ?? joinId}.${joinId}`,
          suggestion: [
            `Declare connector "${joinId}" on the joining part too, or remove it until its mate exists.`
          ]
        })
      );
      continue;
    }

    if (participants.length > 2) {
      const roles = participants
        .map((participant) => participant.part.role)
        .sort((left, right) => left.localeCompare(right));
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "SEAMLINT_CONNECTOR_JOIN_OVERPAIRED",
          message:
            `Connector "${joinId}" is declared by ${roles.length} parts (${roles.join(", ")}), so Loomit cannot tell which two sides form the seam and skipped it.`,
          target: joinId,
          suggestion: [
            `Give each seam a distinct connector id so "${joinId}" joins exactly two parts.`
          ]
        })
      );
      continue;
    }

    const sortedParticipants = [...participants].sort((left, right) =>
      left.part.role.localeCompare(right.part.role)
    );
    const from = sortedParticipants[0];
    const to = sortedParticipants[1];

    if (from === undefined || to === undefined) {
      continue;
    }

    // check id と marker key は role・joinId・rangeId を区切り文字(":" "." "/" "__")で連結して作る。
    // これらに区切り文字が混ざると別の seam と同じキーへ化けて衝突し、marker は別の点を黙って上書きして
    // 幾何を壊す。安全でない識別子は skip し、理由を出す。
    if (
      !isDelimiterSafeIdentifier(from.part.role) ||
      !isDelimiterSafeIdentifier(to.part.role) ||
      !isDelimiterSafeIdentifier(joinId)
    ) {
      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: "SEAMLINT_UNSAFE_JOIN_IDENTIFIER",
          message:
            `Join "${joinId}" (${from.part.role} / ${to.part.role}) uses a part role or connector id containing a reserved separator (":", ".", "/", or "__"), so Loomit skipped it to avoid colliding Seamlint check ids or markers.`,
          target: `${from.part.role}.${joinId}/${to.part.role}.${joinId}`,
          suggestion: [
            `Rename the part role or connector id to avoid ":", ".", "/", and "__" before handing this seam to Seamlint.`
          ]
        })
      );
      continue;
    }

    if (from.connector.type !== to.connector.type) {
      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: "SEAMLINT_CONNECTOR_TYPE_MISMATCH",
          message:
            `Connector "${joinId}" uses different types on ${from.part.role} and ${to.part.role}, so Loomit cannot auto-build one Seamlint seam request for it yet.`,
          target: `${from.part.role}.${joinId}/${to.part.role}.${joinId}`,
          suggestion: [
            `Keep connector "${joinId}" on both parts aligned to one seam type before handing it off to Seamlint.`
          ]
        })
      );
      continue;
    }

    // 片側だけ map に書き込んで孤立させないよう、両側を先に検証してから commit する。どちらかが失敗したら
    // (path_ref / preview 欠落など)診断だけ出して join ごと skip する。
    const fromSide = resolveGeometrySide(
      from.part,
      joinId,
      from.connector,
      partSourceCache,
      diagnostics
    );
    const toSide = resolveGeometrySide(to.part, joinId, to.connector, partSourceCache, diagnostics);

    if (fromSide === undefined || toSide === undefined) {
      continue;
    }

    if (hasConnectorRanges(from.connector) || hasConnectorRanges(to.connector)) {
      // range を宣言した connector は whole-seam の sewn-seam check を出さない。かつ gathered-seam は
      // どちらがギャザー元(source)か Loomit には測れず、向き未確定のまま check を出すと Seamlint に逆向きの
      // semantics を渡してしまう(警告は diagnostics 止まりで request.checks には乗らない)。よって現状は
      // gathered-seam check を emit しない。結果としてこの seam は必ず無検査になるので、ambiguous な geometry を
      // 渡さないよう part も commit せず(参照されない path を残さない)、range 診断と無検査になる旨だけ出す。
      diagnoseConnectorRanges({
        joinId,
        fromPart: from.part,
        toPart: to.part,
        fromConnector: from.connector,
        toConnector: to.connector,
        diagnostics
      });
      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: "SEAMLINT_CONNECTOR_LEFT_UNCHECKED",
          message:
            `Connector "${joinId}" declares connector ranges but Loomit emitted no Seamlint check for it, so this seam is left entirely unchecked.`,
          target: `${from.part.role}.${joinId}/${to.part.role}.${joinId}`,
          suggestion: [
            `Resolve the accompanying range diagnostic, or remove the ranges so the seam falls back to a plain sewn-seam check.`
          ]
        })
      );
      continue;
    }

    const fromGeometryPart = commitGeometrySide(geometryParts, fromSide);
    const toGeometryPart = commitGeometrySide(geometryParts, toSide);

    const toleranceMm = resolveJoinedConnectorToleranceMm(from.connector, to.connector);

    checks.push({
      id: `sewn-seam:${from.part.role}.${joinId}/${to.part.role}.${joinId}`,
      kind: "sewn-seam",
      from: {
        partId: fromGeometryPart.partId,
        pathRef: joinId,
        connectorId: joinId
      },
      to: {
        partId: toGeometryPart.partId,
        pathRef: joinId,
        connectorId: joinId
      },
      ...(toleranceMm === undefined
        ? {}
        : {
            tolerance: {
              length_mm: toleranceMm
            }
          })
    });
  }

  return {
    request: {
      projectRoot: resolvedProject.paths.projectRoot,
      parts: [...geometryParts.values()].map((part) => ({
        partId: part.partId,
        geometrySource: part.geometrySource,
        format: part.format,
        unit: part.unit,
        scale: part.scale,
        paths: { ...part.paths },
        ...(Object.keys(part.markers).length === 0 ? {} : { markers: { ...part.markers } })
      })),
      checks
    },
    diagnostics
  };
}

// role・connector id・range id は id/marker キーの構成要素になる。区切り文字が混ざると別の seam と
// 衝突するため、":" "." "/" "\\"、および marker 区切りの "__" を含まないことを要求する。
function isDelimiterSafeIdentifier(value: string): boolean {
  return !/[:./\\]/.test(value) && !value.includes("__");
}

function collectPartsByJoinId(resolvedProject: ResolvedProject): Map<string, JoinParticipant[]> {
  const partsByJoinId = new Map<string, JoinParticipant[]>();

  for (const part of Object.values(resolvedProject.parts)) {
    for (const [joinId, connector] of Object.entries(part.part.connectors ?? {})) {
      const participants = partsByJoinId.get(joinId) ?? [];
      participants.push({ part, connector });
      partsByJoinId.set(joinId, participants);
    }
  }

  return new Map([...partsByJoinId.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function hasConnectorRanges(connector: Connector): boolean {
  return (connector.ranges?.length ?? 0) > 0;
}

// seam の片側を検証する(mutation はしない)。path_ref は connector 単位、geometrySource(preview)は
// part 単位で確認し、どちらかが欠けていれば診断を出して undefined を返す。
function resolveGeometrySide(
  part: ResolvedProjectPart,
  connectorId: string,
  connector: Connector,
  partSourceCache: Map<string, ResolvedPartGeometry | null>,
  diagnostics: Diagnostic[]
): ResolvedGeometrySide | undefined {
  const pathRef = connector.path_ref;
  if (pathRef === undefined) {
    diagnostics.push(
      createDiagnostic({
        severity: "warning",
        code: "SEAMLINT_CONNECTOR_PATH_REF_MISSING",
        message:
          `Connector "${connectorId}" on part "${part.role}" has no path_ref, so Loomit cannot point Seamlint at the seam geometry yet.`,
        target: `${part.role}.${connectorId}`,
        suggestion: [
          `Set connectors.${connectorId}.path_ref to the exported seam path before building a Seamlint request.`
        ]
      })
    );
    return undefined;
  }

  const geometry = resolvePartGeometry(part, partSourceCache, diagnostics);
  if (geometry === undefined) {
    return undefined;
  }

  return {
    role: part.role,
    connectorId,
    pathRef: normalizePathRefForSeamlint(pathRef),
    geometrySource: geometry.geometrySource,
    format: geometry.format
  };
}

// part の測定用ソース(files.geometry を優先、無ければ files.preview)と format を解決する。ソースは
// part 単位なので結果を memo 化し、欠落警告(と再計算)を part につき1度だけにする。
function resolvePartGeometry(
  part: ResolvedProjectPart,
  partSourceCache: Map<string, ResolvedPartGeometry | null>,
  diagnostics: Diagnostic[]
): ResolvedPartGeometry | undefined {
  const cached = partSourceCache.get(part.role);
  if (cached !== undefined) {
    return cached === null ? undefined : cached;
  }

  const preferredSource =
    part.part.files?.geometry === undefined
      ? part.part.files?.preview === undefined
        ? undefined
        : { path: part.part.files.preview, kind: "preview" as const }
      : { path: part.part.files.geometry, kind: "geometry" as const };
  if (preferredSource === undefined) {
    diagnostics.push(
      createDiagnostic({
        severity: "warning",
        code: "SEAMLINT_GEOMETRY_SOURCE_MISSING",
        message:
          `Part "${part.role}" has no files.geometry or files.preview entry, so Loomit does not know which geometry source Seamlint should read for its seams.`,
        target: part.filePath,
        suggestion: [
          `Add files.geometry (DXF) or files.preview (SVG) for part "${part.role}" so Loomit can hand its seam geometry to Seamlint.`
        ]
      })
    );
    partSourceCache.set(part.role, null);
    return undefined;
  }

  const absoluteSourcePath = join(dirname(part.filePath), preferredSource.path);
  if (!existsSync(absoluteSourcePath)) {
    diagnostics.push(
      createDiagnostic({
        severity: "warning",
        code: "SEAMLINT_GEOMETRY_SOURCE_FILE_MISSING",
        message:
          `Part "${part.role}" points files.${preferredSource.kind} at "${preferredSource.path}", but that geometry file does not exist, so Loomit skipped its Seamlint handoff.`,
        target: absoluteSourcePath,
        suggestion: [
          `Add the missing ${preferredSource.kind} file, or update part "${part.role}" files.${preferredSource.kind} to an existing path.`
        ]
      })
    );
    partSourceCache.set(part.role, null);
    return undefined;
  }

  const resolved: ResolvedPartGeometry = {
    geometrySource: absoluteSourcePath,
    format: geometryFormatOf(preferredSource.path)
  };
  partSourceCache.set(part.role, resolved);
  return resolved;
}

// ソースパスの拡張子から format を導く。.dxf は測定用 DXF、それ以外は視覚用 SVG として扱う。
function geometryFormatOf(sourcePath: string): SeamlintGeometrySourceFormat {
  return sourcePath.toLowerCase().endsWith(".dxf") ? "dxf" : "svg";
}

// 検証済みの片側を geometryParts に書き込む。既存 part には path を足し、無ければ新規エントリを作る。
function commitGeometrySide(
  geometryParts: Map<string, MutableGeometryPartRef>,
  side: ResolvedGeometrySide
): MutableGeometryPartRef {
  const existing = geometryParts.get(side.role);
  if (existing !== undefined) {
    existing.paths[side.connectorId] = side.pathRef;
    return existing;
  }

  const created: MutableGeometryPartRef = {
    partId: side.role,
    geometrySource: side.geometrySource,
    format: side.format,
    unit: "mm",
    scale: 1,
    markers: {},
    paths: {
      [side.connectorId]: side.pathRef
    }
  };
  geometryParts.set(side.role, created);
  return created;
}

function normalizePathRefForSeamlint(pathRef: string): string {
  const fragmentIndex = pathRef.indexOf("#");

  if (fragmentIndex >= 0 && fragmentIndex < pathRef.length - 1) {
    return pathRef.slice(fragmentIndex + 1);
  }

  return pathRef.startsWith("#") ? pathRef.slice(1) : pathRef;
}

// connector range の整合を診断する。現状は check を1つも emit しない(diagnostics 専用):gathered-seam は
// 向き未確定で出せず(下記)、それ以外の behavior はまだ非対応のため。向き(gathered_source)を表せる
// メタデータを導入したら、ここで gathered-seam check を組み立てて emit する経路を足す。
function diagnoseConnectorRanges(input: {
  readonly joinId: string;
  readonly fromPart: ResolvedProjectPart;
  readonly toPart: ResolvedProjectPart;
  readonly fromConnector: Connector;
  readonly toConnector: Connector;
  readonly diagnostics: Diagnostic[];
}): void {
  const fromRanges = indexConnectorRanges(input.fromConnector);
  const toRanges = indexConnectorRanges(input.toConnector);
  const fromIds = new Set(Object.keys(fromRanges));
  const toIds = new Set(Object.keys(toRanges));
  const sharedIds = [...fromIds].filter((id) => toIds.has(id)).sort((left, right) =>
    left.localeCompare(right)
  );

  for (const rangeId of sharedIds) {
    const fromRange = fromRanges[rangeId];
    const toRange = toRanges[rangeId];

    if (fromRange === undefined || toRange === undefined) {
      continue;
    }

    if (fromRange.behavior !== toRange.behavior) {
      input.diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: "SEAMLINT_CONNECTOR_RANGE_BEHAVIOR_MISMATCH",
          message:
            `Connector range "${rangeId}" on join "${input.joinId}" uses different behaviors on ${input.fromPart.role} and ${input.toPart.role}, so Loomit cannot map it to one Seamlint check.`,
          target: `${input.fromPart.role}.${input.joinId}/${input.toPart.role}.${input.joinId}`,
          suggestion: [
            `Keep connector range "${rangeId}" aligned to one behavior on both parts before handing it off to Seamlint.`
          ]
        })
      );
      continue;
    }

    if (fromRange.behavior !== "gathered") {
      input.diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: "SEAMLINT_CONNECTOR_RANGE_BEHAVIOR_UNSUPPORTED",
          message:
            `Connector range "${rangeId}" on join "${input.joinId}" uses behavior "${fromRange.behavior}", but this adapter only auto-builds gathered subrange checks so far.`,
          target: `${input.fromPart.role}.${input.joinId}/${input.toPart.role}.${input.joinId}`,
          suggestion: [
            `Keep "${rangeId}" as a plain whole-seam check, or extend the adapter before treating behavior "${fromRange.behavior}" as a Seamlint range check.`
          ]
        })
      );
      continue;
    }

    // allowance_mm が両側で食い違うのは、ギャザー分量の意図が揃っていないということ。現状の Seamlint
    // request にはギャザー量を載せる場が無い(contract 未確定)ので、少なくとも不一致は警告で拾う。
    if (
      fromRange.allowance_mm !== undefined &&
      toRange.allowance_mm !== undefined &&
      fromRange.allowance_mm !== toRange.allowance_mm
    ) {
      input.diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: "SEAMLINT_CONNECTOR_RANGE_ALLOWANCE_MISMATCH",
          message:
            `Gathered range "${rangeId}" on join "${input.joinId}" declares different allowance_mm on ${input.fromPart.role} (${fromRange.allowance_mm}) and ${input.toPart.role} (${toRange.allowance_mm}).`,
          target: `${input.fromPart.role}.${input.joinId}.${rangeId}/${input.toPart.role}.${input.joinId}.${rangeId}`,
          suggestion: [
            `Align allowance_mm for range "${rangeId}" on both parts so the intended gather amount is unambiguous.`
          ]
        })
      );
    }

    // Seamlint 契約では gathered-seam の from=ギャザー元 / to=縫い先で、gatherRatio = source / target。
    // だが Loomit は仕上がり幾何を測らない(A案)ため、どちらが実際にギャザーされる(=長い)側かを確定できない。
    // 向き未確定のまま check を出すと Seamlint に逆向きの semantics を渡してしまい、しかもこの警告は
    // diagnostics 止まりで request.checks には乗らない(機械側には伝わらない)。よって向きが確定できるように
    // なるまで gathered-seam check は emit せず、警告だけ出す(seam は呼び出し側で LEFT_UNCHECKED になる)。
    input.diagnostics.push(
      createDiagnostic({
        severity: "warning",
        code: "SEAMLINT_GATHER_DIRECTION_UNRESOLVED",
        message:
          `Gathered range "${rangeId}" on join "${input.joinId}" (${input.fromPart.role} / ${input.toPart.role}) has no recorded gather direction and Loomit cannot measure which side is gathered, so it did not emit a gathered-seam check (the seam is reported as unchecked instead).`,
        target: `${input.fromPart.role}.${input.joinId}.${rangeId}/${input.toPart.role}.${input.joinId}.${rangeId}`,
        suggestion: [
          `Record which side is the gathered (fuller) edge for range "${rangeId}" so Loomit can hand Seamlint a correctly-oriented gathered-seam check.`
        ]
      })
    );
  }

  const unmatchedRangeIds = [...new Set([...fromIds, ...toIds])]
    .filter((id) => !fromIds.has(id) || !toIds.has(id))
    .sort((left, right) => left.localeCompare(right));

  if (unmatchedRangeIds.length > 0) {
    input.diagnostics.push(
      createDiagnostic({
        severity: "warning",
        code: "SEAMLINT_CONNECTOR_RANGE_MATCH_MISSING",
        message:
          `Join "${input.joinId}" has connector ranges that do not line up by id on both parts, so Loomit skipped those subrange checks.`,
        target: `${input.fromPart.role}.${input.joinId}/${input.toPart.role}.${input.joinId}`,
        suggestion: [
          `Use matching connector range ids on both parts for ${unmatchedRangeIds.join(", ")} before handing subrange checks to Seamlint.`
        ]
      })
    );
  }
}
