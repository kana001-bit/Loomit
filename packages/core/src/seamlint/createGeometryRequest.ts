import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { ResolvedProject, ResolvedProjectPart } from "../project/resolveParts.js";
import { classifyJoinSides } from "../schema/connectorSides.js";
import { resolveJoinedConnectorToleranceMm } from "../schema/connectorTolerance.js";
import { indexConnectorRanges } from "../schema/connectorRanges.js";
import type { IndexedConnectorRange } from "../schema/connectorRanges.js";
import type { Connector } from "../schema/part.schema.js";

// from/to が厳密に 0/1 でなく 0.001/0.999 で書き出される実データも「seam 全体を覆う」とみなす境界許容。
const WHOLE_SEAM_EPSILON = 0.001;

export type SeamlintJoinKind =
  | "smooth-continuation"
  | "sewn-seam"
  // seam-edge: path_ref が指す BLOCK 全体(外周)ではなく、宣言ペアが実際に縫い合う共有辺を Seamlint が
  // structuralEdges で発見して測る。両側 DXF の平 seam でだけ使う(SVG は辺分割できない)。
  | "seam-edge"
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

// seam-edge の per-connector 識別子。connector が宣言する「その seam の合印(notch)数」を運び、Seamlint が
// 同じ2 BLOCK を共有する複数 seam を辺ごとの notch 署名で区別できるようにする(幾何ではなく宣言データ)。
export interface SeamlintGeometryEdgeSignature {
  readonly notchCount?: number;
}

export interface SeamlintGeometryCheckSpec {
  readonly id: string;
  readonly kind: SeamlintJoinKind;
  readonly from: SeamlintGeometryTarget;
  readonly to?: SeamlintGeometryTarget;
  readonly tolerance?: SeamlintGeometryTolerance;
  readonly range?: SeamlintGeometryCheckRange;
  readonly edgeSignature?: SeamlintGeometryEdgeSignature;
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

    // side のトポロジは connectorSides の共有分類器で判定する(connector-pairing と同じ真実を使い、slnt 単独実行
    // でも loom check と食い違わないようにする)。不正なトポロジ(3側 / 不完全)は defer でなく本来の診断を出す。
    const topology = classifyJoinSides(participants.map((participant) => participant.connector.side));

    if (topology.kind === "too-many-sides") {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "SEAMLINT_CONNECTOR_JOIN_TOO_MANY_SIDES",
          message:
            `Connector "${joinId}" declares ${topology.sides.length} sides (${topology.sides.join(", ")}); a seam joins exactly two sides, so Loomit cannot build a seam request for it.`,
          target: joinId,
          suggestion: [
            `Use distinct connector ids for separate seams, or regroup the parts into two sides.`
          ]
        })
      );
      continue;
    }

    if (topology.kind === "sides-incomplete") {
      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: "SEAMLINT_CONNECTOR_JOIN_SIDES_INCOMPLETE",
          message:
            `Connector "${joinId}" is a contiguous seam with an incomplete set of sides, so Loomit did not build a seam request for it.`,
          target: joinId,
          suggestion: [
            `Give every participating part a side and declare both sides, or drop side to treat it as a stacked seam.`
          ]
        })
      );
      continue;
    }

    // ここまで来れば coincident(重ね)か contiguous(連続2側)= 正当なデザイン。3枚以上は pairwise の seam request を
    // 作れないので、N-ary/和のジオメトリは Seamlint に defer する(assembly (d))。error ではなく先送りの warning。
    if (participants.length > 2) {
      const roles = participants
        .map((participant) => participant.part.role)
        .sort((left, right) => left.localeCompare(right));
      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: "SEAMLINT_CONNECTOR_SEAM_DEFERRED",
          message:
            `Connector "${joinId}" is declared by ${roles.length} parts (${roles.join(", ")}); Loomit only emits pairwise (two-part) seam requests for now, so its ${topology.kind === "contiguous" ? "contiguous" : "stacked"} geometry check is deferred.`,
          target: joinId,
          suggestion: [
            `This is expected for stacked (facing/lining) or contiguous (armhole) seams; measuring their combined length is a future Seamlint step.`
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
      // range を宣言した connector は whole-seam の sewn-seam check を出さない。代わりに range の behavior を見て
      // 出せる check だけを組み立てる。現状 emit できるのは「seam 全体を覆う ease range 1本＋両側一致の ease 帯」を
      // eased-seam にするケースだけ(planConnectorRanges が返す)。gathered は向き(ギャザー元/縫い先)を Loomit が
      // 測れず、逆向きの semantics を渡しかねないため出さない。subrange ease / 帯欠落 / mismatch も ambiguous なので
      // 出さない。emit できる check が1つも無ければ、参照されない path を残さないよう geometry も commit せず、
      // この seam を無検査として報告する。
      const rangeChecks = planConnectorRanges({
        joinId,
        fromPart: from.part,
        toPart: to.part,
        fromConnector: from.connector,
        toConnector: to.connector,
        diagnostics
      });

      if (rangeChecks.length === 0) {
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

      // emit する check があるので、片側だけ孤立させないよう両側を commit してから push する。
      commitGeometrySide(geometryParts, fromSide);
      commitGeometrySide(geometryParts, toSide);
      checks.push(...rangeChecks);
      continue;
    }

    const fromGeometryPart = commitGeometrySide(geometryParts, fromSide);
    const toGeometryPart = commitGeometrySide(geometryParts, toSide);

    const toleranceMm = resolveJoinedConnectorToleranceMm(from.connector, to.connector);

    // path_ref は現状 BLOCK 全体(ピース丸ごと)を指す。両側 DXF なら Seamlint が structuralEdges で
    // 実際に縫い合う共有辺を発見して測れるので seam-edge を使い、BLOCK 外周を丸ごと比べる ceiling を外す。
    // SVG は辺分割できないので従来どおり whole-path の sewn-seam に倒す(どちらでも path_ref/tolerance は不変)。
    const kind: SeamlintJoinKind =
      fromSide.format === "dxf" && toSide.format === "dxf" ? "seam-edge" : "sewn-seam";

    // seam-edge のとき、connector が宣言した notch 署名を渡す(同じ2 BLOCK を共有する複数 seam の per-connector 判別)。
    // sewn-seam(SVG 側 fallback)は辺分割しないので署名を付けない。
    const notchCount =
      kind === "seam-edge"
        ? resolveJoinedConnectorNotchCount(from, to, joinId, diagnostics)
        : undefined;

    checks.push({
      id: `${kind}:${from.part.role}.${joinId}/${to.part.role}.${joinId}`,
      kind,
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
          }),
      ...(notchCount === undefined ? {} : { edgeSignature: { notchCount } })
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

// 両側 connector が宣言した notch 数を1つに解決する。同じ seam なので両側同数のはず。両側宣言かつ食い違うときは
// warning を出して署名を付けない(誤った辺に解決させない)。片側だけ宣言ならそれを使う(同じ seam に対する宣言)。
function resolveJoinedConnectorNotchCount(
  from: JoinParticipant,
  to: JoinParticipant,
  joinId: string,
  diagnostics: Diagnostic[]
): number | undefined {
  const fromCount = from.connector.notch_count;
  const toCount = to.connector.notch_count;

  if (fromCount === undefined && toCount === undefined) {
    return undefined;
  }

  if (fromCount !== undefined && toCount !== undefined && fromCount !== toCount) {
    diagnostics.push(
      createDiagnostic({
        severity: "warning",
        code: "SEAMLINT_CONNECTOR_NOTCH_COUNT_MISMATCH",
        message:
          `Connector "${joinId}" declares different notch counts on ${from.part.role} (${fromCount}) and ${to.part.role} (${toCount}), so Loomit did not hand Seamlint a notch signature to disambiguate the seam.`,
        target: `${from.part.role}.${joinId}/${to.part.role}.${joinId}`,
        suggestion: [
          `Align connectors.${joinId}.notch_count on both parts (a seam has the same notches on both pieces).`
        ]
      })
    );
    return undefined;
  }

  return fromCount ?? toCount;
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

// connector range を見て、この seam に対して emit できる Seamlint check を組み立てて返す。あわせて emit
// できない range(subrange ease / gathered / ease 帯欠落 / mismatch …)の理由を diagnostics に積む。
// 現状 emit できるのは「seam 全体を覆う ease range 1本＋両側で一致した ease 帯」= eased-seam だけ。gathered は
// 向き未確定(下記)で出せず、それ以外の behavior はまだ非対応。向き(gathered_source)を表せるメタデータを
// 入れたら、ここに gathered-seam check を組み立てる経路を足す。
function planConnectorRanges(input: {
  readonly joinId: string;
  readonly fromPart: ResolvedProjectPart;
  readonly toPart: ResolvedProjectPart;
  readonly fromConnector: Connector;
  readonly toConnector: Connector;
  readonly diagnostics: Diagnostic[];
}): SeamlintGeometryCheckSpec[] {
  const checks: SeamlintGeometryCheckSpec[] = [];
  const fromRanges = indexConnectorRanges(input.fromConnector);
  const toRanges = indexConnectorRanges(input.toConnector);
  const fromIds = new Set(Object.keys(fromRanges));
  const toIds = new Set(Object.keys(toRanges));
  const sharedIds = [...fromIds].filter((id) => toIds.has(id)).sort((left, right) =>
    left.localeCompare(right)
  );
  // ease を whole-seam として emit できるのは、両側とも range がこの1本きり(subrange と混在しない)のとき。
  const isSoleRange = fromIds.size === 1 && toIds.size === 1;

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

    if (fromRange.behavior === "ease") {
      const easeCheck = planWholeSeamEase({
        joinId: input.joinId,
        rangeId,
        fromPart: input.fromPart,
        toPart: input.toPart,
        fromRange,
        toRange,
        isSoleRange,
        diagnostics: input.diagnostics
      });
      if (easeCheck !== undefined) {
        checks.push(easeCheck);
      }
      continue;
    }

    if (fromRange.behavior === "gathered") {
      diagnoseGatheredRange({
        joinId: input.joinId,
        rangeId,
        fromPart: input.fromPart,
        toPart: input.toPart,
        fromRange,
        toRange,
        diagnostics: input.diagnostics
      });
      continue;
    }

    input.diagnostics.push(
      createDiagnostic({
        severity: "warning",
        code: "SEAMLINT_CONNECTOR_RANGE_BEHAVIOR_UNSUPPORTED",
        message:
          `Connector range "${rangeId}" on join "${input.joinId}" uses behavior "${fromRange.behavior}", which this adapter does not map to a Seamlint check yet.`,
        target: `${input.fromPart.role}.${input.joinId}/${input.toPart.role}.${input.joinId}`,
        suggestion: [
          `Keep "${rangeId}" as a plain whole-seam check, or extend the adapter before treating behavior "${fromRange.behavior}" as a Seamlint range check.`
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

  return checks;
}

// whole-seam ease を eased-seam check に落とす。落とせないケース(subrange / 帯欠落 / mismatch)は理由を
// 診断して undefined を返す。Seamlint の eased-seam は seam 全体の長さ比しか見ないので、subrange ease は
// 受け皿が無く出せない。帯(ease_ratio)が無いと Seamlint は sewn-seam と同じ厳格長さ許容で測ってしまい、
// 意図した ease をまさに flag するため、帯が無ければ出さず authored な帯を促す(安全側)。
function planWholeSeamEase(input: {
  readonly joinId: string;
  readonly rangeId: string;
  readonly fromPart: ResolvedProjectPart;
  readonly toPart: ResolvedProjectPart;
  readonly fromRange: IndexedConnectorRange;
  readonly toRange: IndexedConnectorRange;
  readonly isSoleRange: boolean;
  readonly diagnostics: Diagnostic[];
}): SeamlintGeometryCheckSpec | undefined {
  const { joinId, rangeId, fromPart, toPart, fromRange, toRange } = input;
  const seamTarget = `${fromPart.role}.${joinId}/${toPart.role}.${joinId}`;
  const rangeTarget = `${fromPart.role}.${joinId}.${rangeId}/${toPart.role}.${joinId}.${rangeId}`;

  if (!input.isSoleRange || !isWholeSeamRange(fromRange) || !isWholeSeamRange(toRange)) {
    input.diagnostics.push(
      createDiagnostic({
        severity: "warning",
        code: "SEAMLINT_CONNECTOR_RANGE_EASE_SUBRANGE_UNSUPPORTED",
        message:
          `Connector range "${rangeId}" on join "${joinId}" applies ease to part of the seam (or alongside other ranges), but Seamlint only checks ease across the whole seam, so Loomit did not build an eased-seam check for it.`,
        target: seamTarget,
        suggestion: [
          `Declare the ease as a single range covering the whole seam (from 0 to 1), or wait for subrange-ease support before handing "${rangeId}" to Seamlint.`
        ]
      })
    );
    return undefined;
  }

  const fromMin = fromRange.ease_ratio_min;
  const fromMax = fromRange.ease_ratio_max;
  const toMin = toRange.ease_ratio_min;
  const toMax = toRange.ease_ratio_max;

  if (fromMin === undefined || fromMax === undefined || toMin === undefined || toMax === undefined) {
    const anyBand =
      fromMin !== undefined || fromMax !== undefined || toMin !== undefined || toMax !== undefined;
    input.diagnostics.push(
      anyBand
        ? easeRatioMismatchDiagnostic({ joinId, rangeId, fromPart, toPart, fromRange, toRange, rangeTarget })
        : createDiagnostic({
            severity: "warning",
            code: "SEAMLINT_EASE_RATIO_UNRESOLVED",
            message:
              `Whole-seam ease range "${rangeId}" on join "${joinId}" has no ease_ratio_min/ease_ratio_max, so Loomit cannot tell Seamlint how much length difference to accept and did not emit an eased-seam check (the seam is reported as unchecked instead).`,
            target: rangeTarget,
            suggestion: [
              `Set ease_ratio_min and ease_ratio_max on range "${rangeId}" (matching on both parts) so Loomit can hand Seamlint an eased-seam check with an ease band.`
            ]
          })
    );
    return undefined;
  }

  if (fromMin !== toMin || fromMax !== toMax) {
    input.diagnostics.push(
      easeRatioMismatchDiagnostic({ joinId, rangeId, fromPart, toPart, fromRange, toRange, rangeTarget })
    );
    return undefined;
  }

  // 両側で一致した ease 帯があるので eased-seam を emit する。partId=role, pathRef/connectorId=joinId は
  // sewn-seam と同じ(paths[joinId] に normalize 済みの path が commit 側で入る)。
  return {
    id: `eased-seam:${fromPart.role}.${joinId}/${toPart.role}.${joinId}`,
    kind: "eased-seam",
    from: {
      partId: fromPart.role,
      pathRef: joinId,
      connectorId: joinId
    },
    to: {
      partId: toPart.role,
      pathRef: joinId,
      connectorId: joinId
    },
    tolerance: {
      ease_ratio: [fromMin, fromMax]
    }
  };
}

// gathered range の整合を診断する。check は出さない(向き未確定・下記)。
function diagnoseGatheredRange(input: {
  readonly joinId: string;
  readonly rangeId: string;
  readonly fromPart: ResolvedProjectPart;
  readonly toPart: ResolvedProjectPart;
  readonly fromRange: IndexedConnectorRange;
  readonly toRange: IndexedConnectorRange;
  readonly diagnostics: Diagnostic[];
}): void {
  const { joinId, rangeId, fromPart, toPart, fromRange, toRange } = input;

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
          `Gathered range "${rangeId}" on join "${joinId}" declares different allowance_mm on ${fromPart.role} (${fromRange.allowance_mm}) and ${toPart.role} (${toRange.allowance_mm}).`,
        target: `${fromPart.role}.${joinId}.${rangeId}/${toPart.role}.${joinId}.${rangeId}`,
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
        `Gathered range "${rangeId}" on join "${joinId}" (${fromPart.role} / ${toPart.role}) has no recorded gather direction and Loomit cannot measure which side is gathered, so it did not emit a gathered-seam check (the seam is reported as unchecked instead).`,
      target: `${fromPart.role}.${joinId}.${rangeId}/${toPart.role}.${joinId}.${rangeId}`,
      suggestion: [
        `Record which side is the gathered (fuller) edge for range "${rangeId}" so Loomit can hand Seamlint a correctly-oriented gathered-seam check.`
      ]
    })
  );
}

// seam 全体を覆う range か(from≈0 かつ to≈1)。0.001/0.999 の実データも許容する。
function isWholeSeamRange(range: IndexedConnectorRange): boolean {
  return range.from <= WHOLE_SEAM_EPSILON && range.to >= 1 - WHOLE_SEAM_EPSILON;
}

// ease 帯を人が読める形にする。未設定側は "unset"。
function formatEaseBand(range: IndexedConnectorRange): string {
  if (range.ease_ratio_min === undefined || range.ease_ratio_max === undefined) {
    return "unset";
  }
  return `[${range.ease_ratio_min}, ${range.ease_ratio_max}]`;
}

// 両側の ease 帯が揃わない(片側だけ / 値違い)ときの警告。emit を止める2箇所で共有する。
function easeRatioMismatchDiagnostic(input: {
  readonly joinId: string;
  readonly rangeId: string;
  readonly fromPart: ResolvedProjectPart;
  readonly toPart: ResolvedProjectPart;
  readonly fromRange: IndexedConnectorRange;
  readonly toRange: IndexedConnectorRange;
  readonly rangeTarget: string;
}): Diagnostic {
  const { joinId, rangeId, fromPart, toPart, fromRange, toRange } = input;
  return createDiagnostic({
    severity: "warning",
    code: "SEAMLINT_CONNECTOR_RANGE_EASE_RATIO_MISMATCH",
    message:
      `Whole-seam ease range "${rangeId}" on join "${joinId}" declares different ease bands on ${fromPart.role} (${formatEaseBand(fromRange)}) and ${toPart.role} (${formatEaseBand(toRange)}), so Loomit cannot pick one ease band for Seamlint.`,
    target: input.rangeTarget,
    suggestion: [
      `Align ease_ratio_min/ease_ratio_max for range "${rangeId}" on both parts so the ease band is unambiguous.`
    ]
  });
}
