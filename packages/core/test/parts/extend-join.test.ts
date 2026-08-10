import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { extendJoin } from "../../src/index.js";

interface PartSpec {
  readonly role: string;
  // その part が宣言する connector(id -> side)。side を省くと coincident(重ね)の参加になる。
  readonly connectors?: Readonly<Record<string, string | undefined>>;
}

// 指定どおりの part.loom を持つ project を組む。connector の id / side を直に書けるので、
// band 形・1対1・不健全な側構成といった「入口の状態」を正確に作れる。
async function makeProject(parts: readonly PartSpec[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "loomit-extend-join-"));

  await writeFile(
    join(root, "loomit.yml"),
    [
      "schema: loomit.project.v0",
      "name: extend-join",
      "garment: skirt",
      "parts:",
      ...parts.map((part) => `  ${part.role}: ./parts/${part.role}/part.loom`)
    ].join("\n"),
    "utf8"
  );

  for (const part of parts) {
    await mkdir(join(root, "parts", part.role), { recursive: true });

    const connectorLines = Object.entries(part.connectors ?? {}).flatMap(([id, side]) => [
      `  ${id}:`,
      `    type: ${id}`,
      ...(side === undefined ? [] : [`    side: ${side}`])
    ]);

    await writeFile(
      join(root, "parts", part.role, "part.loom"),
      [
        "schema: loomit.part.v0",
        `name: ${part.role}`,
        "variant: v1",
        "type: body",
        ...(connectorLines.length === 0 ? [] : ["connectors:", ...connectorLines])
      ].join("\n"),
      "utf8"
    );
  }

  return root;
}

// band(waistband 1枚) + neighbours(front, back 2枚)の典型的な band seam。
const bandParts: readonly PartSpec[] = [
  { role: "waistband", connectors: { waist: "band" } },
  { role: "front", connectors: { waist: "neighbour" } },
  { role: "back", connectors: { waist: "neighbour" } },
  { role: "lining" }
];

function codesOf(diagnostics: readonly { readonly code: string }[]): readonly string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

describe("extendJoin", () => {
  it("refuses to grow the band side of a band seam", async () => {
    // 守る仕様: band は定義上ちょうど1枚。band 側に足すと両側とも複数枚になり、findBandShape が band 形を
    // 見つけられず band-seam の実測が発行されなくなる(SEAMLINT_CONNECTOR_SEAM_DEFERRED)。しかも
    // loom check は contiguous として健全のままなので診断では気づけない ── だから助言でなくここで拒否する。
    const root = await makeProject(bandParts);

    try {
      const result = await extendJoin({
        projectPath: root,
        role: "lining",
        id: "waist",
        side: "band"
      });

      expect(result.ok).toBe(false);
      expect(codesOf(result.diagnostics)).toContain("CONNECT_BAND_SIDE_LOCKED");
      // 安全な側を案内に含める(拒否だけして行き先を示さない、をしない)。
      expect(result.diagnostics[0]?.suggestion?.join(" ")).toContain('side "neighbour"');
      // 拒否したときは書かない。
      expect(await readFile(join(root, "parts/lining/part.loom"), "utf8")).not.toContain("waist");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("adds to the neighbour side and keeps the band as the band", async () => {
    // 守る仕様: neighbour 側への追加は band 形を保つ(1枚の側は waistband のまま)。書き込んだ結果と、
    // 確定した band を返して呼び出し側が示せるようにする。type は既存の宣言から継ぐ(同じ縫い目=同じ種類)。
    const root = await makeProject(bandParts);

    try {
      const result = await extendJoin({
        projectPath: root,
        role: "lining",
        id: "waist",
        side: "neighbour"
      });

      expect(result.ok).toBe(true);

      if (!result.ok) {
        return;
      }

      expect(result.value.side).toBe("neighbour");
      expect(result.value.type).toBe("waist");
      expect(result.value.bandRole).toBe("waistband");
      expect(result.value.participants).toEqual(["waistband", "front", "back", "lining"]);

      const lining = await readFile(join(root, "parts/lining/part.loom"), "utf8");
      expect(lining).toContain("waist:");
      expect(lining).toContain("side: neighbour");
      expect(lining).toContain("type: waist");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("decides the band when a side-per-piece seam gains its third participant", async () => {
    // 守る仕様: 側が1枚ずつの縫い目では band がまだ決まっていない(参加2枚は pairwise 経路で、band-seam は
    // 3枚目から)。3枚目を足すと**足さなかった側**が1枚で残って band になる。Loomit はどちらが物理的な band
    // かを保持していないので検証はできない ── 確定した結果を返し、呼び出し側が作者に見せられるようにする。
    const root = await makeProject([
      { role: "waistband", connectors: { waist: "band" } },
      { role: "front", connectors: { waist: "neighbour" } },
      { role: "back" }
    ]);

    try {
      // neighbour 側に足す = waistband が1枚で残る = 意図どおり waistband が band。
      const result = await extendJoin({
        projectPath: root,
        role: "back",
        id: "waist",
        side: "neighbour"
      });

      expect(result.ok).toBe(true);
      expect(result.ok ? result.value.bandRole : undefined).toBe("waistband");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports the band that the author's side choice actually produces", async () => {
    // 守る仕様(上の対): 同じ1対1でも band 側に足せば front が1枚で残り、band は front になる。ここは
    // 拒否しない(band がまだ決まっていないので「壊す」対象が無い)が、**確定した band を返す**ことで
    // 作者が意図と違えば気づける。返さないと、逆向きの band-seam が黙って発行される。
    const root = await makeProject([
      { role: "waistband", connectors: { waist: "band" } },
      { role: "front", connectors: { waist: "neighbour" } },
      { role: "back" }
    ]);

    try {
      const result = await extendJoin({
        projectPath: root,
        role: "back",
        id: "waist",
        side: "band"
      });

      expect(result.ok).toBe(true);
      expect(result.ok ? result.value.bandRole : undefined).toBe("front");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("requires a side on a seam that declares sides", async () => {
    // 守る仕様: side を持つ縫い目には --side 必須。推論しない ── side は「どの unit に属すか」という
    // 作者にしか分からない宣言で、Loomit が当てると誤った側に足しても気づけない。
    const root = await makeProject(bandParts);

    try {
      const result = await extendJoin({ projectPath: root, role: "lining", id: "waist" });

      expect(result.ok).toBe(false);
      expect(codesOf(result.diagnostics)).toContain("CONNECT_SIDE_REQUIRED");
      // 選べる側を案内に列挙する。
      expect(result.diagnostics[0]?.suggestion?.join(" ")).toContain("band, neighbour");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a side the seam does not declare", async () => {
    // 守る仕様: 存在しない側を新しく生やさない。3つ目の側は「1本の縫い目が3 unit を繋ぐ」ことになり
    // CONNECTOR_JOIN_TOO_MANY_SIDES(error)になる。
    const root = await makeProject(bandParts);

    try {
      const result = await extendJoin({
        projectPath: root,
        role: "lining",
        id: "waist",
        side: "hem"
      });

      expect(result.ok).toBe(false);
      expect(codesOf(result.diagnostics)).toContain("CONNECT_SIDE_UNKNOWN");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("joins a coincident seam without a side", async () => {
    // 守る仕様: side を持たない重ね(coincident)への参加は id を宣言するだけで完結する。band は無いので
    // bandRole も返さない。表地＋見返し＋裏地のような重ねがこの経路。
    const root = await makeProject([
      { role: "front", connectors: { facing_edge: undefined } },
      { role: "facing", connectors: { facing_edge: undefined } },
      { role: "lining" }
    ]);

    try {
      const result = await extendJoin({ projectPath: root, role: "lining", id: "facing_edge" });

      expect(result.ok).toBe(true);
      expect(result.ok ? result.value.side : "unset").toBeUndefined();
      expect(result.ok ? result.value.bandRole : "unset").toBeUndefined();

      const lining = await readFile(join(root, "parts/lining/part.loom"), "utf8");
      expect(lining).toContain("facing_edge:");
      expect(lining).not.toContain("side:");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a side on a coincident seam", async () => {
    // 守る仕様: 側を持たない縫い目に side を1つだけ書くと classifyJoinSides が mixed と見て
    // CONNECTOR_JOIN_SIDES_INCOMPLETE になる。書ける前に止める。
    const root = await makeProject([
      { role: "front", connectors: { facing_edge: undefined } },
      { role: "facing", connectors: { facing_edge: undefined } },
      { role: "lining" }
    ]);

    try {
      const result = await extendJoin({
        projectPath: root,
        role: "lining",
        id: "facing_edge",
        side: "neighbour"
      });

      expect(result.ok).toBe(false);
      expect(codesOf(result.diagnostics)).toContain("CONNECT_SIDE_UNEXPECTED");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to extend a seam where some participant declares no side", async () => {
    // 守る仕様: side を宣言していない参加者が混ざっている(mixed)縫い目に1枚足しても健全にならない
    // ── 足りないのは新しい参加者ではなく、既に居る参加者の側の宣言だから。壊れた構成を広げさせない。
    const root = await makeProject([
      { role: "waistband", connectors: { waist: "band" } },
      { role: "front", connectors: { waist: "neighbour" } },
      { role: "back", connectors: { waist: undefined } },
      { role: "lining" }
    ]);

    try {
      const result = await extendJoin({
        projectPath: root,
        role: "lining",
        id: "waist",
        side: "neighbour"
      });

      expect(result.ok).toBe(false);
      expect(codesOf(result.diagnostics)).toContain("CONNECT_JOIN_SIDES_UNHEALTHY");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("lets a new participant supply the missing second side of a one-side seam", async () => {
    // 守る仕様: 側が1種類しか無い縫い目は「2つ目の側がまだ無い」だけで、壊れて手詰まりなのではない。
    // 参加者を1枚足して反対側を名乗れば contiguous が完成するので、そこは通す(既存の側しか許さないと、
    // 片側だけの縫い目を完成させる手が無くなる)。側ラベルの文字列自体には意味が無く、classifyJoinSides は
    // distinct な側の数だけを見る。
    const root = await makeProject([
      { role: "front", connectors: { waist: "hip" } },
      { role: "back", connectors: { waist: "hip" } },
      { role: "waistband" }
    ]);

    try {
      const result = await extendJoin({
        projectPath: root,
        role: "waistband",
        id: "waist",
        side: "band"
      });

      expect(result.ok).toBe(true);
      // 2側になり、1枚で残った waistband が band に確定する。
      expect(result.ok ? result.value.bandRole : undefined).toBe("waistband");
      expect(await readFile(join(root, "parts/waistband/part.loom"), "utf8")).toContain(
        "side: band"
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to inherit a type when the participants disagree about it", async () => {
    // 守る仕様: 参加者間で connector.type が割れている縫い目からは type を継がない。代表値は宣言順
    // (loomit.yml の並び)で決まる任意の値なので、継ぐと割れを1枚ぶん広げることになる。Seamlint も
    // この状態では SEAMLINT_CONNECTOR_TYPE_MISMATCH を出して seam request を組まない。
    const root = await makeProject([
      { role: "front", connectors: { seam: undefined } },
      { role: "back", connectors: { seam: undefined } },
      { role: "lining" }
    ]);

    try {
      // back の type だけ書き換えて、同じ id で type が食い違う状態にする。
      const backPath = join(root, "parts/back/part.loom");
      const back = await readFile(backPath, "utf8");
      await writeFile(backPath, back.replace("type: seam", "type: hem"), "utf8");

      const result = await extendJoin({ projectPath: root, role: "lining", id: "seam" });

      expect(result.ok).toBe(false);
      expect(codesOf(result.diagnostics)).toContain("CONNECT_JOIN_TYPE_CONFLICT");
      expect(await readFile(join(root, "parts/lining/part.loom"), "utf8")).not.toContain("seam:");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a notch count that contradicts what the seam already declares", async () => {
    // 守る仕様: 既に宣言されている合印数と違う値は書かせない。同じ縫い目なら合印の数も同じはずで、
    // 割れると createGeometryRequest は notch 署名そのものを渡さない
    // (SEAMLINT_CONNECTOR_NOTCH_COUNT_MISMATCH)。署名が落ちると、同じ2 BLOCK を共有する複数 seam を
    // Seamlint が辺ごとに区別できなくなる ── 書けてしまうと「宣言はしたのに識別に効かない」状態になる。
    const root = await makeProject([
      { role: "front", connectors: { seam: undefined } },
      { role: "back", connectors: { seam: undefined } },
      { role: "lining" }
    ]);

    try {
      // front と back に notch_count: 2 を入れる。
      for (const role of ["front", "back"]) {
        const path = join(root, `parts/${role}/part.loom`);
        const text = await readFile(path, "utf8");
        await writeFile(path, `${text.trimEnd()}\n    notch_count: 2\n`, "utf8");
      }

      const conflicting = await extendJoin({
        projectPath: root,
        role: "lining",
        id: "seam",
        notchCount: 3
      });

      expect(conflicting.ok).toBe(false);
      expect(codesOf(conflicting.diagnostics)).toContain("CONNECT_NOTCH_COUNT_CONFLICT");
      expect(await readFile(join(root, "parts/lining/part.loom"), "utf8")).not.toContain("seam:");

      // 一致する値なら通る。
      const matching = await extendJoin({
        projectPath: root,
        role: "lining",
        id: "seam",
        notchCount: 2
      });

      expect(matching.ok).toBe(true);
      expect(await readFile(join(root, "parts/lining/part.loom"), "utf8")).toContain(
        "notch_count: 2"
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not suggest a notch count to match when the seam's own declarations disagree", async () => {
    // 守る仕様: 既にこの縫い目の中で合印数が割れているときは「この値に合わせろ」と言わない。どの値を
    // 選んでも残りと食い違うので、案内どおり打ち直すたびに別の値を勧められて往復する。既存の宣言を
    // 先に揃えさせる方へ倒す。
    const root = await makeProject([
      { role: "front", connectors: { seam: undefined } },
      { role: "back", connectors: { seam: undefined } },
      { role: "lining" }
    ]);

    try {
      // front=2 / back=3 で、縫い目の中で既に割れている状態にする。
      for (const [role, count] of [
        ["front", "2"],
        ["back", "3"]
      ]) {
        const path = join(root, `parts/${role}/part.loom`);
        const text = await readFile(path, "utf8");
        await writeFile(path, `${text.trimEnd()}\n    notch_count: ${count}\n`, "utf8");
      }

      const result = await extendJoin({
        projectPath: root,
        role: "lining",
        id: "seam",
        notchCount: 2
      });

      expect(result.ok).toBe(false);
      expect(codesOf(result.diagnostics)).toContain("CONNECT_NOTCH_COUNT_CONFLICT");

      const suggestion = result.diagnostics[0]?.suggestion?.join(" ") ?? "";
      // 往復する案内(「--notches 3 に合わせろ」)を出さず、既存を揃えさせる。
      expect(suggestion).not.toContain("--notches 3");
      expect(suggestion).toContain("no value can match them all");
      expect(suggestion).toContain("front, back");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses a documented diagnostic target for the notch conflict", async () => {
    // 守る仕様: target は {role}.{connector-id}.{property}(testing-diagnostics の「解決済み requirement」
    // と同じ形)。`{connector-id}.notch_count` にすると {connector-id}.{side} の形と衝突し、読む側が
    // "notch_count" を側の名前と取り違える。
    const root = await makeProject([
      { role: "front", connectors: { seam: undefined } },
      { role: "back", connectors: { seam: undefined } },
      { role: "lining" }
    ]);

    try {
      const path = join(root, "parts/front/part.loom");
      const text = await readFile(path, "utf8");
      await writeFile(path, `${text.trimEnd()}\n    notch_count: 2\n`, "utf8");

      const result = await extendJoin({
        projectPath: root,
        role: "lining",
        id: "seam",
        notchCount: 5
      });

      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]?.target).toBe("lining.seam.notch_count");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("allows joining without a notch count even when the seam declares one", async () => {
    // 守る仕様: notch を宣言しないのは食い違いではない(片側だけの宣言は resolveJoinedConnectorNotchCount が
    // そのまま使う)。identity だけの connector を許す schema の立場とも揃える ── 後から足せる。
    const root = await makeProject([
      { role: "front", connectors: { seam: undefined } },
      { role: "back", connectors: { seam: undefined } },
      { role: "lining" }
    ]);

    try {
      const path = join(root, "parts/front/part.loom");
      const text = await readFile(path, "utf8");
      await writeFile(path, `${text.trimEnd()}\n    notch_count: 2\n`, "utf8");

      const result = await extendJoin({ projectPath: root, role: "lining", id: "seam" });

      expect(result.ok).toBe(true);
      expect(await readFile(join(root, "parts/lining/part.loom"), "utf8")).not.toContain(
        "notch_count"
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports an unknown join id instead of creating a new seam", async () => {
    // 守る仕様: 拡張は既存 join 専用。id の打ち間違いを新しい縫い目に化けさせない(黙って別の縫い目が
    // 増えると、繋いだつもりのパーツが相手待ちのまま残る)。
    const root = await makeProject(bandParts);

    try {
      const result = await extendJoin({
        projectPath: root,
        role: "lining",
        id: "wiast",
        side: "neighbour"
      });

      expect(result.ok).toBe(false);
      expect(codesOf(result.diagnostics)).toContain("CONNECT_JOIN_NOT_FOUND");
      expect(await readFile(join(root, "parts/lining/part.loom"), "utf8")).not.toContain("wiast");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports a role that is not registered in the project", async () => {
    // 守る仕様: 未登録 role には書けない(その part が無い)。
    const root = await makeProject(bandParts);

    try {
      const result = await extendJoin({
        projectPath: root,
        role: "sleeve",
        id: "waist",
        side: "neighbour"
      });

      expect(result.ok).toBe(false);
      expect(codesOf(result.diagnostics)).toContain("CONNECT_ROLE_NOT_FOUND");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps refusing to overwrite a connector the part already declares", async () => {
    // 守る仕様: 既に同じ id を宣言している part への「追加」は上書きになる。拡張モードでも黙って
    // 上書きしない(縫い直しは編集 or 別 id)。新規作成側のガードと同じ扱い。
    const root = await makeProject(bandParts);

    try {
      const result = await extendJoin({
        projectPath: root,
        role: "front",
        id: "waist",
        side: "neighbour"
      });

      expect(result.ok).toBe(false);
      expect(codesOf(result.diagnostics)).toContain("CONNECT_ID_ALREADY_DECLARED");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps exactly one Japanese/English boundary in every refusal message", async () => {
    // 守る仕様: 日英併記の message に埋め込む詳細は英語のまま、併記を閉じたあとに1回だけ置く。
    // 詳細自体を併記にすると `日本語 / English (日本語 / English)` と区切りが2つ出て、どちらが日英の
    // 切れ目か読めなくなる(testing-diagnostics の「Messages that carry a detail」)。
    // 文言ごとに個別のテストを書くと足すたびに漏れるので、この関数の拒否経路をまとめて走らせて数える。
    // 健全な band seam(側系の拒否を個別に踏むため)と、側が3つの壊れた縫い目を別々に用意する。
    // 1つの project にまとめると unhealthy の判定が先に立って、他の経路を踏めない。
    const healthy = await makeProject(bandParts);
    const broken = await makeProject([
      { role: "front", connectors: { waist: "a" } },
      { role: "back", connectors: { waist: "b" } },
      { role: "extra", connectors: { waist: "c" } },
      { role: "lining" }
    ]);

    try {
      const refusals = [
        // side 必須 / 未知の側 / band 側 / join が無い / role が無い
        await extendJoin({ projectPath: healthy, role: "lining", id: "waist" }),
        await extendJoin({ projectPath: healthy, role: "lining", id: "waist", side: "nope" }),
        await extendJoin({ projectPath: healthy, role: "lining", id: "waist", side: "band" }),
        await extendJoin({ projectPath: healthy, role: "lining", id: "nope", side: "band" }),
        await extendJoin({ projectPath: healthy, role: "nope", id: "waist", side: "band" }),
        // 側が3つ(unhealthy)。詳細を併記にすると区切りが2つ出る、を実際に踏む経路。
        await extendJoin({ projectPath: broken, role: "lining", id: "waist", side: "a" })
      ];

      // 意図した拒否コードを全部踏めていることも確かめる(1つの分岐に吸われて空振りしないように)。
      expect(refusals.flatMap((refusal) => codesOf(refusal.diagnostics))).toEqual([
        "CONNECT_SIDE_REQUIRED",
        "CONNECT_SIDE_UNKNOWN",
        "CONNECT_BAND_SIDE_LOCKED",
        "CONNECT_JOIN_NOT_FOUND",
        "CONNECT_ROLE_NOT_FOUND",
        "CONNECT_JOIN_SIDES_UNHEALTHY"
      ]);

      for (const refusal of refusals) {
        for (const diagnostic of refusal.diagnostics) {
          expect(
            diagnostic.message.split(" / "),
            `${diagnostic.code}: ${diagnostic.message}`
          ).toHaveLength(2);
        }
      }
    } finally {
      await rm(healthy, { recursive: true, force: true });
      await rm(broken, { recursive: true, force: true });
    }
  });

  it("refuses to judge the seam when a registered part.loom cannot be read", async () => {
    // 守る仕様: 台帳が不完全なまま band 判定をしない。側の枚数を数え落とすと「1枚の側」を取り違えて、
    // band 側への追加を通してしまう。読めない part.loom は診断ごと返して止める。
    const root = await makeProject(bandParts);

    try {
      await rm(join(root, "parts/back/part.loom"));

      const result = await extendJoin({
        projectPath: root,
        role: "lining",
        id: "waist",
        side: "neighbour"
      });

      expect(result.ok).toBe(false);
      expect(codesOf(result.diagnostics)).toContain("FILE_READ_FAILED");
      expect(await readFile(join(root, "parts/lining/part.loom"), "utf8")).not.toContain("waist");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
