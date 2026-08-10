import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { collectExistingJoins, combineJoins, suggestJoinId } from "../../src/index.js";
import type { ExistingJoin } from "../../src/index.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

// 台帳のテスト用プロジェクト。宣言順(front が waist を先に書く)と id 昇順が食い違うように置き、
// 並びが宣言順に引きずられないことを確かめられるようにする。
async function makeJoinProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "loomit-join-inventory-"));

  await writeFile(
    join(root, "loomit.yml"),
    [
      "schema: loomit.project.v0",
      "name: join-inventory",
      "garment: skirt",
      "parts:",
      "  front: ./parts/front/part.loom",
      "  back: ./parts/back/part.loom"
    ].join("\n"),
    "utf8"
  );

  await mkdir(join(root, "parts/front"), { recursive: true });
  await writeFile(
    join(root, "parts/front/part.loom"),
    [
      "schema: loomit.part.v0",
      "name: front",
      "variant: v1",
      "type: body",
      "connectors:",
      "  waist:",
      "    type: waist",
      "  side:",
      "    type: side"
    ].join("\n"),
    "utf8"
  );

  await mkdir(join(root, "parts/back"), { recursive: true });
  await writeFile(
    join(root, "parts/back/part.loom"),
    [
      "schema: loomit.part.v0",
      "name: back",
      "variant: v1",
      "type: body",
      "connectors:",
      "  side:",
      "    type: side"
    ].join("\n"),
    "utf8"
  );

  return root;
}

// band seam を持つプロジェクト。`loom connect <band> --to <neighbours...>` が書く形(band 側1枚 /
// neighbour 側 N 枚、両側が side を宣言)を手書きで用意する。
async function makeBandSeamProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "loomit-join-band-"));

  await writeFile(
    join(root, "loomit.yml"),
    [
      "schema: loomit.project.v0",
      "name: join-band",
      "garment: skirt",
      "parts:",
      "  waistband: ./parts/waistband/part.loom",
      "  front: ./parts/front/part.loom",
      "  back: ./parts/back/part.loom"
    ].join("\n"),
    "utf8"
  );

  const writePart = async (role: string, side: string): Promise<void> => {
    await mkdir(join(root, "parts", role), { recursive: true });
    await writeFile(
      join(root, "parts", role, "part.loom"),
      [
        "schema: loomit.part.v0",
        `name: ${role}`,
        "variant: v1",
        "type: body",
        "connectors:",
        "  waist:",
        "    type: waist",
        `    side: ${side}`
      ].join("\n"),
      "utf8"
    );
  };

  await writePart("waistband", "band");
  await writePart("front", "neighbour");
  await writePart("back", "neighbour");

  return root;
}

describe("collectExistingJoins", () => {
  it("groups the connectors of every part under their shared join id", async () => {
    // 守る仕様: 台帳は「join id -> 種類(type) と宣言している role」。同じ id を宣言した2パーツは
    // 1件にまとまり roles に両方が並ぶ(check がその id で参加者を集めるのと同じ括り方)。
    const result = await collectExistingJoins(join(fixturesRoot, "valid-blouse"));

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value : []).toEqual([
      { id: "armhole", type: "armhole", roles: ["body", "sleeve"], sides: [] }
    ]);
  });

  it("sorts joins by id, not by declaration order", async () => {
    // 守る仕様: 返す順は id 昇順。宣言順(front は waist を先に書く)に引きずられない。
    // 呼び出し側は候補一覧をそのまま並べるので、同じプロジェクトなら毎回同じ並びで出す必要がある。
    const root = await makeJoinProject();

    try {
      const result = await collectExistingJoins(root);

      expect(result.ok ? result.value.map((entry) => entry.id) : []).toEqual(["side", "waist"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports how many parts declare each join without calling two of them closed", async () => {
    // 守る仕様: roles は「その join に参加を宣言しているパーツ」をそのまま並べるだけで、枚数に上限は無い。
    // 1枚なら相手待ち(CONNECTOR_JOIN_OPEN の対象)だが、2枚は「閉じた」わけではない ── seam は参加エッジの
    // 集合で、見返し・裏地のような重ねは N 枚が1本に参加する(glossary の Connector 節 / over-pair は退役)。
    // ここで「2枚=これ以上足せない」と読める形を返すと、呼び出し側が3枚目を拒む導線を作ってしまう。
    const root = await makeJoinProject();

    try {
      const result = await collectExistingJoins(root);

      expect(result.ok ? result.value : []).toEqual([
        { id: "side", type: "side", roles: ["front", "back"], sides: [] },
        { id: "waist", type: "waist", roles: ["front"], sides: [] }
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("groups participants by side so the band side can be told from the neighbour side", async () => {
    // 守る仕様: side を宣言している縫い目(contiguous / band)は、側ラベルだけでなく**側ごとの参加者**を返す。
    // 側の名前だけでは「どちらに足してよいか」を言えない ── band seam は片側がちょうど1枚(band)で成立し、
    // findBandShape はその1枚の側を探して band と判定する。1枚の側に足して両側とも複数枚になると band 形が
    // 消え、SEAMLINT_CONNECTOR_SEAM_DEFERRED に落ちて band-seam の実測が発行されなくなる(しかも check は
    // contiguous として健全のままなので診断では気づけない)。安全な側を名指しするには各側の枚数が要る。
    const root = await makeBandSeamProject();

    try {
      const result = await collectExistingJoins(root);

      expect(result.ok ? result.value : []).toEqual([
        {
          id: "waist",
          type: "waist",
          roles: ["waistband", "front", "back"],
          sides: [
            { side: "band", roles: ["waistband"] },
            { side: "neighbour", roles: ["front", "back"] }
          ]
        }
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports no sides for a seam where nobody declares one", async () => {
    // 守る仕様: side を誰も宣言していない縫い目の sides は空。空 = coincident(重ね)で、参加は「同じ id を
    // 宣言する」だけで完結する、という読み方を固定する(空と「側あり」を取り違えると導線が逆になる)。
    const result = await collectExistingJoins(join(fixturesRoot, "valid-blouse"));

    expect(result.ok ? result.value.map((entry) => entry.sides) : []).toEqual([[]]);
  });

  it("leaves a participant that declares no side out of every side group", async () => {
    // 守る仕様: 側の宣言が不完全(mixed)なとき、side を持たない参加者は roles には出るが、どの側にも
    // 数えない。適当な側に混ぜると各側の枚数が実態より増え、「1枚の側=band」の判定を誤らせる。
    const root = await makeBandSeamProject();

    try {
      // side を書かない4枚目を足す(loom add が side 無しで相乗りしてしまった状態)。
      await mkdir(join(root, "parts/lining"), { recursive: true });
      await writeFile(
        join(root, "parts/lining/part.loom"),
        [
          "schema: loomit.part.v0",
          "name: lining",
          "variant: v1",
          "type: body",
          "connectors:",
          "  waist:",
          "    type: waist"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(root, "loomit.yml"),
        [
          "schema: loomit.project.v0",
          "name: join-band",
          "garment: skirt",
          "parts:",
          "  waistband: ./parts/waistband/part.loom",
          "  front: ./parts/front/part.loom",
          "  back: ./parts/back/part.loom",
          "  lining: ./parts/lining/part.loom"
        ].join("\n"),
        "utf8"
      );

      const result = await collectExistingJoins(root);
      const waist = result.ok ? result.value[0] : undefined;

      expect(waist?.roles).toEqual(["waistband", "front", "back", "lining"]);
      expect(waist?.sides).toEqual([
        { side: "band", roles: ["waistband"] },
        { side: "neighbour", roles: ["front", "back"] }
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails with the load diagnostics instead of reporting an empty inventory", async () => {
    // 守る仕様: project が読めないときは ok:false と診断を返す。空の台帳([])に畳むと、呼び出し側は
    // 「join が1つも無い」と信じて新規 id を提案し、作者は既存の縫い目に繋いだつもりで別の縫い目を作る。
    // errno / 診断を握り潰さない R3 の要求でもある。
    const result = await collectExistingJoins(join(fixturesRoot, "does-not-exist"));

    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("fails with the part diagnostics when a registered part.loom cannot be resolved", async () => {
    // 守る仕様: 登録済み part.loom が欠損・破損しているときも同じ。project は読めても台帳は不完全なので、
    // 「join が無い」ではなく FILE_READ_FAILED を返して呼び出し側に判断させる。
    const result = await collectExistingJoins(join(fixturesRoot, "missing-sleeve"));

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("FILE_READ_FAILED");
  });
});

describe("combineJoins", () => {
  const base: readonly ExistingJoin[] = [{ id: "side", type: "side", roles: ["front"], sides: [] }];

  it("adds the not-yet-persisted roles to a join already in the base", () => {
    // 守る仕様: 同じ id はベースと合流して roles の和になる。直前に足したパーツが宣言した join を、
    // ベースを読み直さずに次のパーツの候補へ載せられる。
    expect(combineJoins(base, new Map([["side", { type: "side", roles: ["back"] }]]))).toEqual([
      { id: "side", type: "side", roles: ["front", "back"], sides: [] }
    ]);
  });

  it("does not duplicate a role that the base already lists", () => {
    // 守る仕様: ベースを遅延ロードした結果、追加分のパーツが既にベースへ含まれていても roles は重複しない。
    // 重複すると roles.length を「何枚参加しているか」として読む呼び出し側の表示が水増しされる。
    expect(combineJoins(base, new Map([["side", { type: "side", roles: ["front"] }]]))).toEqual([
      { id: "side", type: "side", roles: ["front"], sides: [] }
    ]);
  });

  it("keeps the base type when the added join disagrees", () => {
    // 守る仕様: type はベース優先。同じ縫い目なら継承して一致するはずで、食い違ったときに後勝ちさせると
    // 既にディスクにある宣言と候補一覧の表示がずれる。roles は type と関係なく和を取る。
    expect(combineJoins(base, new Map([["side", { type: "hem", roles: ["back"] }]]))).toEqual([
      { id: "side", type: "side", roles: ["front", "back"], sides: [] }
    ]);
  });

  it("keeps the base sides when the added participant declares none", () => {
    // 守る仕様: ベースが側を持つ縫い目なら、side を宣言していない参加を足しても sides は消えない。
    // 消すと呼び出し側が coincident(重ね)と誤認し、side 無しで参加させる導線を出してしまう。
    // 側の無い参加者は roles にだけ現れ、どの側にも数えない(側の枚数を水増ししない)。
    const sided: readonly ExistingJoin[] = [
      {
        id: "waist",
        type: "waist",
        roles: ["waistband"],
        sides: [{ side: "band", roles: ["waistband"] }]
      }
    ];

    expect(combineJoins(sided, new Map([["waist", { type: "waist", roles: ["front"] }]]))).toEqual([
      {
        id: "waist",
        type: "waist",
        roles: ["waistband", "front"],
        sides: [{ side: "band", roles: ["waistband"] }]
      }
    ]);
  });

  it("unions the sides when the added participant declares a new one", () => {
    // 守る仕様: 追加分が新しい side を宣言したら和に加える(band 側だけ知っていた縫い目に neighbour 側が
    // 付いて2側になる、という途中経過をそのまま表せる)。側ごとの参加者も引き継ぐ。
    const sided: readonly ExistingJoin[] = [
      {
        id: "waist",
        type: "waist",
        roles: ["waistband"],
        sides: [{ side: "band", roles: ["waistband"] }]
      }
    ];

    expect(
      combineJoins(
        sided,
        new Map([
          [
            "waist",
            { type: "waist", roles: ["front"], sides: [{ side: "neighbour", roles: ["front"] }] }
          ]
        ])
      )
    ).toEqual([
      {
        id: "waist",
        type: "waist",
        roles: ["waistband", "front"],
        sides: [
          { side: "band", roles: ["waistband"] },
          { side: "neighbour", roles: ["front"] }
        ]
      }
    ]);
  });

  it("returns the union sorted by id, mixing base-only and added-only joins", () => {
    // 守る仕様: ベースにしか無い join と追加分にしか無い join の両方を返し、並びは id 昇順。
    // collectExistingJoins と同じ整列なので、候補一覧の並びがロード済みかどうかで変わらない。
    expect(
      combineJoins(
        base,
        new Map([
          ["waist", { type: "waist", roles: ["front"] }],
          ["hem", { type: "hem", roles: ["front"] }]
        ])
      )
    ).toEqual([
      { id: "hem", type: "hem", roles: ["front"], sides: [] },
      { id: "side", type: "side", roles: ["front"], sides: [] },
      { id: "waist", type: "waist", roles: ["front"], sides: [] }
    ]);
  });

  it("does not mutate the base joins it was given", () => {
    // 守る仕様: ベースの roles と sides をコピーしてから合流する。破壊すると、キャッシュしたベースを次の
    // 呼び出しで使い回す側で参加者や側が足すたびに増えていき、候補一覧の表示と導線が実態からずれる。
    const cached: readonly ExistingJoin[] = [
      { id: "side", type: "side", roles: ["front"], sides: [] }
    ];

    combineJoins(
      cached,
      new Map([
        ["side", { type: "side", roles: ["back"], sides: [{ side: "neighbour", roles: ["back"] }] }]
      ])
    );

    expect(cached).toEqual([{ id: "side", type: "side", roles: ["front"], sides: [] }]);
  });
});

describe("suggestJoinId", () => {
  it("uses the seam type itself when that id is free", () => {
    // 守る仕様: 素直な縫い目は type がそのまま id になる。1本目の side は "side"。
    expect(suggestJoinId("side", [], new Set())).toBe("side");
  });

  it("walks to the next free number when the type is taken", () => {
    // 守る仕様: 2本目の side は別の縫い目なので別 id が要る。埋まっていれば _2, _3… と空きを探す。
    // 同じ id を再提案すると、作者が意図していない縫い目へ黙って参加させることになる。
    const joins: readonly ExistingJoin[] = [
      { id: "side", type: "side", roles: ["front", "back"], sides: [] },
      { id: "side_2", type: "side", roles: ["front"], sides: [] }
    ];

    expect(suggestJoinId("side", joins, new Set())).toBe("side_3");
  });

  it("treats ids chosen in this session as taken even though they are not on disk yet", () => {
    // 守る仕様: chosenIds も taken として見る。見ないと、同じ type の縫い目を続けて2本足すとき2本目も
    // 同じ id を提案し、「同 type で別 id」の縫い目が作れない。
    expect(suggestJoinId("side", [], new Set(["side"]))).toBe("side_2");
  });

  it("falls back to a seam base when the type is not a safe path segment", () => {
    // 守る仕様: connector.type は schema 上ただの非空文字列だが、join id は単一 segment でなければ
    // ならない。区切り文字を含む type("1/4 inch topstitch" のような実際に有りうる入力)や "." / ".." は
    // そのまま id にせず "seam" に倒す。
    expect(suggestJoinId("1/4 inch topstitch", [], new Set())).toBe("seam");
    expect(suggestJoinId("../escape", [], new Set())).toBe("seam");
    expect(suggestJoinId("..", [], new Set())).toBe("seam");
  });

  it("keeps a type with spaces as the id", () => {
    // 守る仕様: 空白は isSafePathSegment が許す(区切り文字でも "." / ".." でもない)ので、"french seam"
    // は倒さずそのまま id になる。ここを "seam" に倒すと、空白を含む縫い目が全て同じ既定 id に集まる。
    expect(suggestJoinId("french seam", [], new Set())).toBe("french seam");
  });

  it("numbers the seam fallback too when seam itself is taken", () => {
    // 守る仕様: 倒した先の "seam" が埋まっていても、番号を振って空き id を返す(候補を出せずに詰まらない)。
    const joins: readonly ExistingJoin[] = [
      { id: "seam", type: "1/4 inch topstitch", roles: ["front"], sides: [] }
    ];

    expect(suggestJoinId("1/4 inch topstitch", joins, new Set())).toBe("seam_2");
  });
});
