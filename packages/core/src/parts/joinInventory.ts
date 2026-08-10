// プロジェクト内の join(縫い合わせ先)の台帳と、新しい join id の命名。
//
// connector の本質は「名前付きの join」で、check は同じ id を宣言しているパーツ同士をペアにする
// (seam の形の分類ではなく id の一致が本質。docs/glossary.md「Connector」)。つまり authoring 側の
// 一番の難所は「どの id に繋ぐか」を間違えないことで、そのために要るのが
//   - 既にどんな join があり、どのパーツが宣言しているか(= この台帳)
//   - 新しい縫い目に付ける、まだ空いている id(= suggestJoinId)
// の2つ。どちらも対話 UI とは独立したドメイン規則なので、CLI ではなくここに置く。

import type { LoadFileResult } from "../filesystem/loadFileResult.js";
import { isSafePathSegment } from "../filesystem/pathWithin.js";
import { loadProject } from "../project/loadProject.js";
import { resolveParts } from "../project/resolveParts.js";

// プロジェクト内に既にある join(縫い合わせ先候補)。id・その種類(type)・宣言しているパーツ(role)を持つ。
// id は縫い目ごとに一意な rendezvous、type は種類ラベル。既存 join に繋ぐときは相手の id と type を継ぐ
// (同じ縫い目なので種類も同じ。第2の当事者に type を訊き直すと同一 seam で分類が食い違いうる)。
//
// roles は「その join に参加を宣言しているパーツ」で、その**枚数に上限は無い**。seam は作者が宣言する
// 参加エッジの集合であって「1本の縫い目 = 2枚」ではない — 見返し・裏地・玉縁は同じ長さの N 枚を1本で
// 縫う coincident な縫い目だし、armhole は多パーツの端どうしを1本で縫う contiguous な縫い目になる
// (`docs/glossary.md` の Connector 節、`docs/design-history.md`「seam は参加エッジの集合、over-pair は退役」)。
// **したがって roles.length >= 2 を「閉じた seam」と読んで追加を拒んではならない。** 3枚目以降が正当か
// どうかは枚数では決まらず、幾何(等長 / 和)の実測は Seamlint が担う。
//
// 枚数から言えるのは1つだけ: roles.length === 1 は相手待ち(`CONNECTOR_JOIN_OPEN` の warning 対象)。
export interface ExistingJoin {
  readonly id: string;
  readonly type: string;
  readonly roles: readonly string[];
  // 側ごとの参加者。空なら coincident(重ね)= 参加は「同じ id を宣言する」だけで完結する。空でなければ
  // contiguous(連続2側・和で合う。armhole や band)で、**新しい参加者は自分がどちらの側に属すかも宣言
  // しなければ健全にならない** ── side 無しで id だけ足すと classifyJoinSides が mixed と見て
  // CONNECTOR_JOIN_SIDES_INCOMPLETE になる。
  //
  // **側ごとの参加者まで持つ理由**: どちらの側に足しても同じ、ではないから。band seam は「片側がちょうど
  // 1枚(band)・反対側が複数枚(neighbours)」で成立し、`findBandShape` は**ちょうど1枚の側**を探して band と
  // 判定する。1枚の側に足して両側とも複数枚になると band 形が消え、`SEAMLINT_CONNECTOR_SEAM_DEFERRED` に
  // 落ちて band-seam の実測そのものが発行されなくなる(check は contiguous として健全のままなので、
  // 診断では気づけない)。安全な側を名指しするには side ラベルだけでなく**各側の参加枚数**が要る。
  readonly sides: readonly JoinSide[];
}

// 1本の縫い目の片側と、そこに属する参加パーツ(宣言順)。roles.length === 1 の側は band 候補。
export interface JoinSide {
  readonly side: string;
  readonly roles: readonly string[];
}

// プロジェクト内の各パーツが宣言している join を、id・種類(type)・宣言元 role をまとめて集める。
// id ごとにまとめて id 昇順で返す。type は最初に見た宣言元の値を採る(継承していれば両者で一致する)。
//
// **読み込みの失敗は空の台帳に畳まない。** project や part.loom が欠損・破損・権限エラーで読めないとき、
// 「join が1つも無い」と返すのは嘘になる。呼び出し側は空プロジェクトだと思って新規 id を提案し、作者は
// 既存の縫い目に繋いだつもりが別の縫い目を作ってしまう(壊れた part を直した後に、意図しない同一 id 参加が
// 現れる)。addPartToProject は既存の全パーツを resolve しないので、新しい part の書き込みだけは成功する。
// errno / 診断を握り潰さない operational-constraints R3 にも反する。よって失敗は診断ごと呼び出し側へ返し、
// 表示して止めるかどうかは呼び出し側に決めさせる。
//
// ok の側の diagnostics(警告)はそのまま運ぶが、これは `loom check` / `loom doctor` が報告する領分なので、
// 対話の途中で出すかどうかは呼び出し側の判断に任せる。
export async function collectExistingJoins(
  projectPath: string
): Promise<LoadFileResult<readonly ExistingJoin[]>> {
  const loaded = await loadProject(projectPath);

  if (!loaded.ok) {
    return { ok: false, diagnostics: loaded.diagnostics };
  }

  const resolved = await resolveParts(loaded.value);

  if (!resolved.ok) {
    return { ok: false, diagnostics: [...loaded.diagnostics, ...resolved.diagnostics] };
  }

  const byJoinId = new Map<string, JoinAccumulator>();

  for (const part of Object.values(resolved.value.parts)) {
    for (const [joinId, connector] of Object.entries(part.part.connectors ?? {})) {
      let entry = byJoinId.get(joinId);

      if (entry === undefined) {
        entry = { type: connector.type, roles: [], sides: new Map() };
        byJoinId.set(joinId, entry);
      }

      entry.roles.push(part.role);
      addSideRole(entry, connector.side, part.role);
    }
  }

  return {
    ok: true,
    value: sortJoins(byJoinId),
    diagnostics: [...loaded.diagnostics, ...resolved.diagnostics]
  };
}

// ベース(ディスク上のパーツが宣言済みの join)と、まだディスクに反映していない join(added)を id ごとに
// 合流し、id 昇順で返す。type はベース優先で運び(継承していれば両者で一致する)、同じ id は roles を
// 和(重複なし)にする。ベースを遅延ロードした結果 added のパーツが既に含まれていても、roles の重複を
// 除くので二重にならない。
//
// 連続して複数パーツを足していく authoring 用。直前に足したパーツが宣言した join を、ベースを読み直さずに
// 次のパーツの候補へ載せられる。
// added は id を除いた ExistingJoin と同じ形にそろえる(sides は省略可)。別形にすると、呼び出し側が
// 側を積んでいるのに combineJoins が読まない、という取りこぼしが構造的型付けをすり抜けて起きる。
export function combineJoins(
  base: readonly ExistingJoin[],
  added: ReadonlyMap<
    string,
    {
      readonly type: string;
      readonly roles: readonly string[];
      readonly sides?: readonly JoinSide[] | undefined;
    }
  >
): readonly ExistingJoin[] {
  const byJoinId = new Map<string, JoinAccumulator>();

  for (const join of base) {
    byJoinId.set(join.id, {
      type: join.type,
      roles: [...join.roles],
      sides: new Map(join.sides.map((entry) => [entry.side, [...entry.roles]]))
    });
  }

  for (const [joinId, join] of added) {
    let entry = byJoinId.get(joinId);

    if (entry === undefined) {
      entry = { type: join.type, roles: [], sides: new Map() };
      byJoinId.set(joinId, entry);
    }

    for (const role of join.roles) {
      if (!entry.roles.includes(role)) {
        entry.roles.push(role);
      }
    }

    // side は和で運ぶ。ベースが側を持つ縫い目なら、まだ側を宣言していない参加を足しても「側のある縫い目」
    // であることは消えない(消すと呼び出し側が coincident と誤認して side 無しの参加を促してしまう)。
    for (const side of join.sides ?? []) {
      for (const role of side.roles) {
        addSideRole(entry, side.side, role);
      }
    }
  }

  return sortJoins(byJoinId);
}

interface JoinAccumulator {
  readonly type: string;
  readonly roles: string[];
  readonly sides: Map<string, string[]>;
}

// 側ごとの参加者に role を1つ積む。side 未宣言(coincident の参加、または側の宣言が不完全な mixed の
// 片割れ)は側に積まない ── 積むと「側のある縫い目」の枚数が実態より増え、band 判定を誤らせる。
function addSideRole(entry: JoinAccumulator, side: string | undefined, role: string): void {
  if (side === undefined) {
    return;
  }

  const roles = entry.sides.get(side) ?? [];

  if (!roles.includes(role)) {
    roles.push(role);
  }

  entry.sides.set(side, roles);
}

// type から新しい join id の既定を導く。type がそのまま単一 segment で空いていれば type を使い、
// 埋まっていれば type_2, type_3… と空き番号を探す(2本目の side は別の縫い目なので別 id になる)。
//
// connector.type は schema 上ただの非空文字列だが、join id は parts 配下に解決されうる単一 segment で
// なければならない。segment にならない type(区切り文字を含む "1/4 inch topstitch" 等、または "." / "..")
// は base を "seam" に倒す。空白は isSafePathSegment が許すので "french seam" はそのまま id になる。
//
// chosenIds は「まだ台帳に無いが、この authoring で既に使うと決めた id」。これを渡さないと、同じ type の
// 縫い目を続けて2本足すとき2本目も同じ id を提案し、同 type で別 id の縫い目が作れなくなる。
export function suggestJoinId(
  type: string,
  existingJoins: readonly ExistingJoin[],
  chosenIds: ReadonlySet<string>
): string {
  const taken = new Set([...existingJoins.map((join) => join.id), ...chosenIds]);
  const base = isSafePathSegment(type) ? type : "seam";

  if (!taken.has(base)) {
    return base;
  }

  for (let n = 2; ; n += 1) {
    const candidate = `${base}_${n}`;

    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

// 積み上げた Map を id 昇順の ExistingJoin[] に均す。collect と combine が同じ整列で候補を返すための
// 共有ヘルパ。side は宣言順に依らず side 名の昇順にそろえる(表示と比較を安定させる)。側の中の roles は
// 宣言順のまま(roles と同じ並びにして、どの側にどれが居るかを読み合わせやすくする)。
function sortJoins(byJoinId: ReadonlyMap<string, JoinAccumulator>): readonly ExistingJoin[] {
  return [...byJoinId.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, { type, roles, sides }]) => ({
      id,
      type,
      roles,
      sides: [...sides.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([side, sideRoles]) => ({ side, roles: sideRoles }))
    }));
}
