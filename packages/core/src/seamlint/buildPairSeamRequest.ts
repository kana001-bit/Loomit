import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { ResolvedProject, ResolvedProjectPart } from "../project/resolveParts.js";
import { classifyJoinSides } from "../schema/connectorSides.js";
import type { Connector } from "../schema/part.schema.js";
import {
  createSeamlintGeometryRequest,
  type SeamlintGeometryCheckRequest
} from "./createGeometryRequest.js";

export interface PairSeamRequestResult {
  // roleA と roleB の縫い目**だけ**を対象にした pair-local な geometry request。
  readonly request: SeamlintGeometryCheckRequest;
  // その pair の縫い目についての診断だけ(プロジェクト全体の readiness や無関係 connector は含まない)。
  readonly diagnostics: readonly Diagnostic[];
  // 2パーツを繋ぐ connector が1つでもあるか。false = 本当に未接続(MATCH_NO_SEAM の判定に使う)。
  // true でも check が0本のことはある(path_ref 欠落 / defer 等 ── 理由は diagnostics に載る)。
  readonly linked: boolean;
}

interface JoinParticipant {
  readonly role: string;
  readonly connector: Connector;
}

// loom match の土台。プロジェクト全体を測る createSeamlintGeometryRequest に対し、指定2パーツ(roleA/roleB)が
// **互いに縫い合う**縫い目だけを対象にする。実装は「pair の縫い目に関わる connector だけを残した scoped project」を
// 作って createSeamlintGeometryRequest に通す ── こうすると checks も diagnostics も構造的に pair 局所になり、
// 無関係パーツの stray/broken connector や project 全体の readiness ノイズが結果に混ざらない(pair-local 契約)。
// 側の分類は connector-pairing / request 生成と同じ classifyJoinSides を使う(drift を作らない)。純関数。
export function buildPairSeamRequest(
  resolvedProject: ResolvedProject,
  roleA: string,
  roleB: string
): PairSeamRequestResult {
  const participantsByJoin = collectParticipantsByJoin(resolvedProject);

  // roleA と roleB が互いに縫い合う joinId を選ぶ。両者が同じ connector id を宣言し、かつその縫い目で
  // 反対側にいる(または重ね)ときだけ「その2パーツが縫い合う」。band で front/back のように同じ neighbour 側に
  // いる co-neighbour は互いには縫わない(各自 band に縫う)ので除く。
  const pairJoinIds = new Set<string>();
  for (const [joinId, participants] of participantsByJoin) {
    const aParticipant = participants.find((participant) => participant.role === roleA);
    const bParticipant = participants.find((participant) => participant.role === roleB);
    if (aParticipant === undefined || bParticipant === undefined) {
      continue;
    }
    if (sewsPair(participants, aParticipant, bParticipant)) {
      pairJoinIds.add(joinId);
    }
  }

  // pair の縫い目に関わる全パーツ(band なら band＋neighbours 全員)を集め、各パーツの connector を pairJoinIds に
  // 限定した scoped project を作る。これを既存 builder に通せば、pair の checks と診断だけが出る。
  const relevantRoles = new Set<string>();
  for (const joinId of pairJoinIds) {
    for (const participant of participantsByJoin.get(joinId) ?? []) {
      relevantRoles.add(participant.role);
    }
  }

  const scopedParts: Record<string, ResolvedProjectPart> = {};
  for (const role of relevantRoles) {
    const original = resolvedProject.parts[role];
    if (original === undefined) {
      continue;
    }
    scopedParts[role] = {
      ...original,
      part: { ...original.part, connectors: pickConnectors(original.part.connectors, pairJoinIds) }
    };
  }

  const scopedProject: ResolvedProject = { ...resolvedProject, parts: scopedParts };
  const built = createSeamlintGeometryRequest(scopedProject);

  return {
    request: built.request,
    diagnostics: built.diagnostics,
    linked: pairJoinIds.size > 0
  };
}

// joinId ごとに参加者(その id の connector を宣言している part とその connector)を集める。
function collectParticipantsByJoin(resolvedProject: ResolvedProject): Map<string, JoinParticipant[]> {
  const participantsByJoin = new Map<string, JoinParticipant[]>();
  for (const part of Object.values(resolvedProject.parts)) {
    for (const [joinId, connector] of Object.entries(part.part.connectors ?? {})) {
      const participants = participantsByJoin.get(joinId) ?? [];
      participants.push({ role: part.role, connector });
      participantsByJoin.set(joinId, participants);
    }
  }
  return participantsByJoin;
}

// この縫い目で aParticipant と bParticipant が互いに縫い合うか。
function sewsPair(
  participants: readonly JoinParticipant[],
  aParticipant: JoinParticipant,
  bParticipant: JoinParticipant
): boolean {
  const topology = classifyJoinSides(participants.map((participant) => participant.connector.side));

  switch (topology.kind) {
    case "coincident":
      // 重ね(side 無し): 参加者は全員が1本に重ねて縫い合う(見返し/裏地/ポケット重ね)ので a,b も縫い合う。
      return true;
    case "contiguous":
      // 連続2側: a,b が別々の側なら縫い合う。同じ側(co-neighbour)なら互いには縫わない。
      return (
        aParticipant.connector.side !== undefined &&
        bParticipant.connector.side !== undefined &&
        aParticipant.connector.side !== bParticipant.connector.side
      );
    case "sides-incomplete":
    case "too-many-sides":
      // 側の宣言が壊れた共有 connector。両者が宣言している以上 pair の縫い目候補として扱い、理由(診断)を
      // surface させる ── 黙って「未接続」に倒さない(createSeamlintGeometryRequest が該当診断を出す)。
      return true;
  }
}

// connector record を、指定した joinId 集合のものだけに限定する(scoped project 用)。
function pickConnectors(
  connectors: Readonly<Record<string, Connector>> | undefined,
  joinIds: ReadonlySet<string>
): Record<string, Connector> {
  const picked: Record<string, Connector> = {};
  for (const [id, connector] of Object.entries(connectors ?? {})) {
    if (joinIds.has(id)) {
      picked[id] = connector;
    }
  }
  return picked;
}
