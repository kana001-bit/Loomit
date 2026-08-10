import { stat } from "node:fs/promises";

import { stringify } from "yaml";

import type { RegisteredDiagnosticCode } from "../diagnostics/codes.js";
import { createDiagnostic } from "../diagnostics/diagnostic.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { describeFsError } from "../filesystem/fsError.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";
import { isSafePathSegment } from "../filesystem/pathWithin.js";
import { readText } from "../filesystem/readText.js";
import { writeFileAtomic } from "../filesystem/writeFileAtomic.js";
import { loadProject } from "../project/loadProject.js";
import { resolveBandShape } from "../schema/connectorSides.js";
import { isDelimiterSafeIdentifier } from "../schema/joinIdentifier.js";
import { partSchema } from "../schema/part.schema.js";
import type { Connector, Part } from "../schema/part.schema.js";
import { collectExistingJoins } from "./joinInventory.js";
import type { ExistingJoin } from "./joinInventory.js";
import { loadPartFile } from "./loadPartFile.js";

// loom connect の core 実装。「どの2パーツが縫い合うか」を作者が宣言する後付け導線(loom add --yes で骨組みだけ
// 作った後の工程)。connector = 複数パーツを組む cross-part join 専用(design-history)なので、同じ id を両パーツの
// part.loom に対で書く=check がその id でペアにする。人が触るのはトークンだけ(id / path_ref=DXF BLOCK 名 /
// notch_count)で、どの辺が共有縫い線かは Seamlint が幾何から発見する(seam-edge)。辺の座標入力はさせない。
export interface ConnectPartsOptions {
  // project を探す起点(通常は cwd)。ここから loomit.yml を見つけて2パーツの part.loom を引く。
  readonly projectPath: string;
  // 縫い合わせるパーツの role(loomit.yml の parts キー)。connector は cross-part 専用なので相異なる必要がある。
  // (1本の縫い目に3パーツ以上が参加することはある。connect が一度に書くのが2つ、というだけ。)
  readonly roleA: string;
  readonly roleB: string;
  // 縫い目の一意 id(record キー=join id)。両パーツに同じ id を書くことでペアが成立する。
  readonly id: string;
  // 縫い目の種類ラベル。ペアリングには使われない(check は id で繋ぐ)。未指定なら id にフォールバック。
  readonly type?: string;
  // この縫い目の合印(notch)数。同じ2 BLOCK を共有する複数 seam を Seamlint が辺ごとに区別する識別子。両側同値。
  readonly notchCount?: number;
  // 各パーツの測定用幾何の在り処(DXF BLOCK 名)。未指定なら各 part の files.piece を既定にする
  // (files.piece は「detail 名 = DXF export の BLOCK 名」= Seamlint の BLOCK 照合は case 無視なので front→FRONT に当たる)。
  readonly pathRefA?: string;
  readonly pathRefB?: string;
}

// 書き込んだ片側の結果。CLI が「何をどこに書いたか」を示すのに使う。geometry ソースの有無も返し、
// 未設定なら「slnt check はまだ測れない」と促せるようにする。
export interface ConnectedSide {
  readonly role: string;
  readonly filePath: string;
  readonly pathRef: string | undefined;
  // files.geometry か files.preview のどちらかがあるか。無ければ slnt check は幾何ソース欠落で測れない。
  readonly hasGeometrySource: boolean;
  // files.geometry(DXF)があるか。band-seam は DXF 必須(辺分割が要る)なので、SVG preview だけでは測れない。
  readonly hasDxfGeometry: boolean;
}

export interface ConnectedParts {
  readonly id: string;
  readonly type: string;
  readonly notchCount: number | undefined;
  readonly sides: readonly [ConnectedSide, ConnectedSide];
  readonly projectFilePath: string;
}

export async function connectParts(
  options: ConnectPartsOptions
): Promise<LoadFileResult<ConnectedParts>> {
  // connector は cross-part join 専用。自己シーム(同一パーツの二辺)は Loomit のモデル要素にせず Seamlint の
  // same-part request で表す(design-history)ので、同じ role 同士の connect はここで弾く。
  if (options.roleA === options.roleB) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "CONNECT_SAME_ROLE",
          message: `パーツ "${options.roleA}" 同士は connect できません。コネクタは異なるパーツ同士を繋ぎます。 / Cannot connect part "${options.roleA}" to itself; a connector joins parts to each other, not a part to itself.`,
          target: options.roleA,
          suggestion: [
            "Give two distinct part roles. A self-seam (two edges of one piece) is measured by Seamlint, not declared as a connector."
          ]
        })
      ]
    };
  }

  // connector id は part.loom の record キーであると同時に、Seamlint が check id / marker キーを組み立てる
  // join id にもなる。区切り文字(":" "." "/" "\\" "__")や不正な segment を含むと、書けても次の
  // loom slnt check で Seamlint が測定対象から外す(SEAMLINT_UNSAFE_JOIN_IDENTIFIER)。黙って測れない
  // connector を作らないよう、authoring 時にここで弾く(add の segment 制約＋Seamlint の delimiter 制約)。
  if (!isSafePathSegment(options.id) || !isDelimiterSafeIdentifier(options.id)) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "CONNECT_ID_INVALID",
          message: `コネクタ id "${options.id}" は使えません。"/" "\\" ":" "." "__" を含まない1つのトークンにしてください("." と ".." も不可)。 / Connector id "${options.id}" is not usable: it must be a single token without "/", "\\", ":", ".", or "__" (and not "." or "..").`,
          target: options.id,
          suggestion: [
            'Use a simple id like "outseam" or "armhole". Seamlint reserves those characters to build seam ids, so an id with them would be silently dropped by loom slnt check.'
          ]
        })
      ]
    };
  }

  const loadedProjectResult = await loadProject(options.projectPath);

  if (!loadedProjectResult.ok) {
    return loadedProjectResult;
  }

  const { partFilePaths, projectFilePath } = loadedProjectResult.value.paths;

  // 未登録の role は「その part が無い」ので書けない。両方まとめて確認し、欠けている分を1つの診断に列挙する
  // (片方だけ直してもう一度落ちる往復を避ける)。
  const filePathA = partFilePaths[options.roleA];
  const filePathB = partFilePaths[options.roleB];

  if (filePathA === undefined || filePathB === undefined) {
    const missingRoles = [
      ...(filePathA === undefined ? [options.roleA] : []),
      ...(filePathB === undefined ? [options.roleB] : [])
    ];
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "CONNECT_ROLE_NOT_FOUND",
          message: `role ${missingRoles.map((role) => `"${role}"`).join(" / ")} の part が登録されていません。 / No part is registered for role ${missingRoles.map((role) => `"${role}"`).join(" or ")}.`,
          target: missingRoles.join(", "),
          suggestion: [
            "Check the role spelling, or add the part first with loom add. Run loom check to list registered parts."
          ]
        })
      ]
    };
  }

  // role 名が違っても、両 role が同じ part.loom に解決される(loomit.yml の parts で値が重複。project schema は
  // 値の一意を要求しない)なら、物理パーツは1つ。このまま進むと同じファイルを2度書くだけで「2パーツを縫った」
  // 結果にならないのに成功扱いになる。connector は異なるパーツ同士を繋ぐものなので、file 同一性で明示的に弾く
  // (弾いているのは「同一パーツか」であって参加パーツ数ではない。1本の縫い目に3パーツ以上が参加することはある)。
  // (roleA === roleB は上で弾いているが、別名で同一ファイルを指すケースはそこを通り抜ける。)判定は文字列一致
  // だけでなく dev+ino(ファイルの実 identity)で行い、case-insensitive FS(Windows/macOS の Front vs front)や
  // symlink/hardlink 跨ぎの重複も拾う。
  if (await isSamePhysicalFile(filePathA, filePathB)) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "CONNECT_SAME_FILE",
          message: `role "${options.roleA}" と "${options.roleB}" が同じ part.loom に解決されるため、実体は1つのパーツです。コネクタは異なるパーツ同士を繋ぎます。 / Roles "${options.roleA}" and "${options.roleB}" resolve to the same part.loom, so they are one physical part; a connector joins distinct parts.`,
          target: filePathA,
          suggestion: [
            "Point each role at its own part.loom in loomit.yml, or connect two distinct parts."
          ]
        })
      ]
    };
  }

  // 片側だけ書いて対を崩さないよう、両パーツを先に読み・検証してから書き込む。どちらかの load/検証で失敗したら
  // 何も書かない(部分適用しない)。
  const sideA = await prepareSide(filePathA, options.roleA, options.id, options.pathRefA);

  if (!sideA.ok) {
    return sideA;
  }

  const sideB = await prepareSide(filePathB, options.roleB, options.id, options.pathRefB);

  if (!sideB.ok) {
    return sideB;
  }

  const type = options.type ?? options.id;

  const newPartA = withConnector(
    sideA.value.part,
    options.id,
    type,
    sideA.value.pathRef,
    options.notchCount,
    undefined
  );
  const newPartB = withConnector(
    sideB.value.part,
    options.id,
    type,
    sideB.value.pathRef,
    options.notchCount,
    undefined
  );

  // 書き込む前に両パーツを正本 schema で検証する。CLI で弾ききれない値(型など)があっても、schema に合わない
  // part.loom を生成しないための最後の関所。どちらかが不正なら片方も書かない。
  const validatedA = validatePart(newPartA, options.roleA);

  if (!validatedA.ok) {
    return validatedA;
  }

  const validatedB = validatePart(newPartB, options.roleB);

  if (!validatedB.ok) {
    return validatedB;
  }

  // 2ファイル書き込み。A を書いた後 B が失敗したら、A を元のバイト列に巻き戻して「片側だけ繋がった」半端な
  // 状態を残さない(loomit.yml は connector を持たない=触らないので、書くのはこの2つの part.loom だけ)。
  try {
    await writeFileAtomic(filePathA, stringify(validatedA.value));
  } catch (error) {
    return { ok: false, diagnostics: [connectWriteError(error, filePathA)] };
  }

  try {
    await writeFileAtomic(filePathB, stringify(validatedB.value));
  } catch (writeError) {
    // B が書けなかったら A を原バイト列に巻き戻す。その巻き戻しも失敗したら(ディスクフル等)、A だけ
    // connector が残り B は無い半端な状態になる。これを握りつぶさず別診断で明示し、どちらの part.loom を
    // 手で戻せばよいかを示す(B の write 失敗と rollback 失敗の両方を返す)。
    try {
      await writeFileAtomic(filePathA, sideA.value.originalText);
    } catch (rollbackError) {
      return {
        ok: false,
        diagnostics: [
          connectWriteError(writeError, filePathB),
          describeFsError(rollbackError, {
            code: "CONNECT_ROLLBACK_FAILED",
            message: `コネクタ "${options.id}" を "${options.roleA}" に書きましたが、"${options.roleB}" への書き込みも "${options.roleA}" の巻き戻しもできませんでした。片側だけが縫い目を宣言した状態です。 / Wrote connector "${options.id}" to "${options.roleA}" but could not write "${options.roleB}" or undo "${options.roleA}", so only one side declares the seam.`,
            target: filePathA,
            suggestion: [
              `Remove connectors.${options.id} from ${options.roleA}'s part.loom by hand, then run loom connect again.`
            ]
          })
        ]
      };
    }

    return { ok: false, diagnostics: [connectWriteError(writeError, filePathB)] };
  }

  return {
    ok: true,
    value: {
      id: options.id,
      type,
      notchCount: options.notchCount,
      sides: [
        {
          role: options.roleA,
          filePath: filePathA,
          pathRef: sideA.value.pathRef,
          hasGeometrySource: sideA.value.hasGeometrySource,
          hasDxfGeometry: sideA.value.hasDxfGeometry
        },
        {
          role: options.roleB,
          filePath: filePathB,
          pathRef: sideB.value.pathRef,
          hasGeometrySource: sideB.value.hasGeometrySource,
          hasDxfGeometry: sideB.value.hasDxfGeometry
        }
      ],
      projectFilePath
    },
    diagnostics: []
  };
}

export interface ConnectBandOptions {
  // project を探す起点(通常は cwd)。
  readonly projectPath: string;
  // band = singleton 側の1枚。周方向辺(×裁断枚数)が neighbours の接辺の和と合うかを Seamlint が測る。
  readonly bandRole: string;
  // band に縫い付く反対側のピース群(1枚以上)。全員が同じ id・同じ neighbour 側 side を宣言する。
  readonly neighbourRoles: readonly string[];
  // 縫い目の一意 id(record キー=join id)。band と全 neighbour に同じ id を書くことでペアが成立する。
  readonly id: string;
  // 縫い目の種類ラベル。未指定なら id にフォールバック。
  readonly type?: string;
  // neighbours に載せる合印(notch)数。band 側は最長辺を Seamlint が選ぶので載せない。
  readonly notchCount?: number;
  // side ラベル。既定は band / neighbour。classifyJoinSides が2側の contiguous と見なせれば値自体は任意。
  readonly bandSide?: string;
  readonly neighbourSide?: string;
}

export interface ConnectedBand {
  readonly id: string;
  readonly type: string;
  readonly notchCount: number | undefined;
  readonly bandSide: string;
  readonly neighbourSide: string;
  readonly band: ConnectedSide;
  readonly neighbours: readonly ConnectedSide[];
  readonly projectFilePath: string;
}

// band を宣言する: band 1枚 + neighbours N枚 の全 part.loom に同じ id の connector を書き、band 側/neighbour 側を
// side ラベルで分ける。これで loom check は contiguous(2側)と判定し、loom slnt check は band-seam を emit する。
// 「縫い合う」を表すのは共有 id、side は「この N枚は同じ側=長さが足し算で合う」の判別ラベル(pairwise の素の seam は
// side なし)。全 part をまとめて読み・検証してから書き込み、途中で失敗したら書いた分を原バイト列へ巻き戻す(部分適用しない)。
export async function connectBand(
  options: ConnectBandOptions
): Promise<LoadFileResult<ConnectedBand>> {
  const bandSide = options.bandSide ?? "band";
  const neighbourSide = options.neighbourSide ?? "neighbour";

  // side が同一だと classifyJoinSides が1側(不完全)になり band にならない。2側を要求する。
  if (bandSide === neighbourSide) {
    return connectBandError(
      "CONNECT_BAND_SIDE_CONFLICT",
      `Band side and neighbour side are both "${bandSide}"; a band seam needs two distinct sides.`,
      bandSide,
      ["Use different --band-side and --neighbour-side labels (defaults: band / neighbour)."]
    );
  }

  if (options.neighbourRoles.length === 0) {
    return connectBandError(
      "CONNECT_BAND_NO_NEIGHBOURS",
      `Band "${options.bandRole}" has no neighbours to sew to.`,
      options.bandRole,
      ["List at least one neighbour part after --to (the pieces whose edges add up to the band)."]
    );
  }

  // band が neighbours に混ざる / neighbours 重複 = 同じ物理パーツを二重に数える。role 文字列で先に弾く
  // (別名で同一ファイルを指すケースは後段の file-identity で拾う)。
  const roleCounts = new Map<string, number>();
  for (const role of [options.bandRole, ...options.neighbourRoles]) {
    roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
  }
  const duplicated = [...roleCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([role]) => role);
  if (duplicated.length > 0) {
    return connectBandError(
      "CONNECT_BAND_DUPLICATE_ROLE",
      `Roles ${duplicated.map((role) => `"${role}"`).join(", ")} appear more than once; a band and each neighbour must be distinct parts.`,
      duplicated.join(", "),
      ["Give the band and each neighbour a distinct role. A part cannot be both the band and a neighbour."]
    );
  }

  // id は part.loom の record キー兼 Seamlint の join id。区切り文字/不正 segment は測れないので authoring で弾く。
  if (!isSafePathSegment(options.id) || !isDelimiterSafeIdentifier(options.id)) {
    return connectBandError(
      "CONNECT_ID_INVALID",
      `Connector id "${options.id}" is not usable: it must be a single token without "/", "\\", ":", ".", or "__" (and not "." or "..").`,
      options.id,
      ['Use a simple id like "waist" or "armhole". Seamlint reserves those characters to build seam ids.']
    );
  }

  const loadedProjectResult = await loadProject(options.projectPath);

  if (!loadedProjectResult.ok) {
    return loadedProjectResult;
  }

  const { partFilePaths, projectFilePath } = loadedProjectResult.value.paths;

  const allRoles = [options.bandRole, ...options.neighbourRoles];
  const missingRoles = allRoles.filter((role) => partFilePaths[role] === undefined);
  if (missingRoles.length > 0) {
    return connectBandError(
      "CONNECT_ROLE_NOT_FOUND",
      `No part is registered for role ${missingRoles.map((role) => `"${role}"`).join(" or ")}.`,
      missingRoles.join(", "),
      ["Check the role spelling, or add the part first with loom add. Run loom check to list registered parts."]
    );
  }

  // role → filePath(上で全て定義済みを確認済み)。noUncheckedIndexedAccess を満たすためガードして詰める。
  const roleFilePaths: { readonly role: string; readonly filePath: string }[] = [];
  for (const role of allRoles) {
    const filePath = partFilePaths[role];
    if (filePath !== undefined) {
      roleFilePaths.push({ role, filePath });
    }
  }

  // 別名で同一 part.loom を指す組を弾く(同じファイルを二重に数えて偽の band にしない)。全ペアを dev+ino で確認。
  for (let i = 0; i < roleFilePaths.length; i += 1) {
    for (let j = i + 1; j < roleFilePaths.length; j += 1) {
      const a = roleFilePaths[i];
      const b = roleFilePaths[j];
      if (a !== undefined && b !== undefined && (await isSamePhysicalFile(a.filePath, b.filePath))) {
        return connectBandError(
          "CONNECT_SAME_FILE",
          `Roles "${a.role}" and "${b.role}" resolve to the same part.loom, so they are one physical part; a band joins distinct parts.`,
          a.filePath,
          ["Point each role at its own part.loom in loomit.yml, or connect distinct parts."]
        );
      }
    }
  }

  // 全 part を先に読み・検証(prepareSide)。どれかで失敗したら何も書かない。band か neighbour かで side を決める。
  const prepared: BandPreparedEntry[] = [];
  for (const { role, filePath } of roleFilePaths) {
    const side = role === options.bandRole ? bandSide : neighbourSide;
    const result = await prepareSide(filePath, role, options.id, undefined);
    if (!result.ok) {
      return result;
    }
    prepared.push({ role, filePath, side, prepared: result.value });
  }

  const type = options.type ?? options.id;

  // 新 Part を組んで正本 schema で検証。band は notch を載せない(最長辺選択)、neighbours は notchCount を載せる。
  const validated: BandValidatedEntry[] = [];
  for (const entry of prepared) {
    const isBand = entry.role === options.bandRole;
    const newPart = withConnector(
      entry.prepared.part,
      options.id,
      type,
      entry.prepared.pathRef,
      isBand ? undefined : options.notchCount,
      entry.side
    );
    const check = validatePart(newPart, entry.role);
    if (!check.ok) {
      return check;
    }
    validated.push({
      role: entry.role,
      filePath: entry.filePath,
      originalText: entry.prepared.originalText,
      pathRef: entry.prepared.pathRef,
      hasGeometrySource: entry.prepared.hasGeometrySource,
      hasDxfGeometry: entry.prepared.hasDxfGeometry,
      part: check.value
    });
  }

  // 全 part を書き込み。途中で失敗したら、それまでに書いた分を原バイト列に巻き戻す(部分適用しない)。巻き戻しも
  // 失敗したら、どのファイルが半端に残ったかを別診断で明示する。
  const written: { readonly role: string; readonly filePath: string; readonly originalText: string }[] = [];
  for (const entry of validated) {
    try {
      await writeFileAtomic(entry.filePath, stringify(entry.part));
      written.push({ role: entry.role, filePath: entry.filePath, originalText: entry.originalText });
    } catch (writeError) {
      const rollbackFailures: Diagnostic[] = [];
      for (const done of written) {
        try {
          await writeFileAtomic(done.filePath, done.originalText);
        } catch (rollbackError) {
          rollbackFailures.push(
            describeFsError(rollbackError, {
              code: "CONNECT_ROLLBACK_FAILED",
              message: `コネクタ "${options.id}" を "${done.role}" に書きましたが、band を完了することも巻き戻すこともできませんでした。その part.loom には縫い目の宣言が残っています。 / Wrote connector "${options.id}" to "${done.role}" but could not finish the band or undo it, so its part.loom still declares the seam.`,
              target: done.filePath,
              suggestion: [
                `Remove connectors.${options.id} from ${done.role}'s part.loom by hand, then run loom connect again.`
              ]
            })
          );
        }
      }
      return { ok: false, diagnostics: [connectWriteError(writeError, entry.filePath), ...rollbackFailures] };
    }
  }

  const toSide = (entry: BandValidatedEntry): ConnectedSide => ({
    role: entry.role,
    filePath: entry.filePath,
    pathRef: entry.pathRef,
    hasGeometrySource: entry.hasGeometrySource,
    hasDxfGeometry: entry.hasDxfGeometry
  });

  const bandEntry = validated.find((entry) => entry.role === options.bandRole);
  const neighbourEntries = validated.filter((entry) => entry.role !== options.bandRole);

  if (bandEntry === undefined) {
    // 到達しない(band role は allRoles 先頭で検証済み)。型を満たすための保険。
    return connectBandError(
      "CONNECT_ROLE_NOT_FOUND",
      `No part is registered for role "${options.bandRole}".`,
      options.bandRole,
      ["Check the role spelling, or add the part first with loom add."]
    );
  }

  return {
    ok: true,
    value: {
      id: options.id,
      type,
      notchCount: options.notchCount,
      bandSide,
      neighbourSide,
      band: toSide(bandEntry),
      neighbours: neighbourEntries.map(toSide),
      projectFilePath
    },
    diagnostics: []
  };
}

export interface ExtendJoinOptions {
  // project を探す起点(通常は cwd)。
  readonly projectPath: string;
  // 縫い目に足すパーツの role。
  readonly role: string;
  // 参加する**既存の** join id。新規に張るのは connectParts / connectBand の仕事で、こちらは既にある
  // 縫い目に1枚足す操作。id が存在しなければ CONNECT_JOIN_NOT_FOUND で止める(打ち間違いを新しい縫い目に
  // 化けさせない)。
  readonly id: string;
  // どちらの側に属すか。side を持つ縫い目(contiguous / band)では**必須**。推論しないのは、side が
  // 「どの unit に属すか」という作者にしか分からない宣言だから。side を持たない縫い目(coincident=重ね)
  // に渡すと mixed を作ってしまうので、その場合は拒否する。
  readonly side?: string;
  readonly notchCount?: number;
  readonly pathRef?: string;
}

export interface ExtendedJoin {
  readonly id: string;
  // 既存の宣言から継いだ種類ラベル(同じ縫い目なので種類も同じ)。
  readonly type: string;
  readonly notchCount: number | undefined;
  readonly side: string | undefined;
  readonly added: ConnectedSide;
  // 足した後の参加 role(既存の宣言順＋末尾に今回の1枚)。
  readonly participants: readonly string[];
  // 足した結果 band に確定したパーツの role。band 形にならない縫い目では undefined。
  // 1枚ずつの側に3枚目を足すと**ここで初めて band が決まる**ので、呼び出し側はこれを見せて
  // 「意図した band か」を作者に確かめさせられる(Loomit には検証できない)。
  readonly bandRole: string | undefined;
  readonly projectFilePath: string;
}

// 既存の縫い目に part を1枚足す。`loom connect` の新規作成2種(pairwise / band)に対する第3の口で、
// 「もう張ってある縫い目に参加する」を表す。新規作成が既存 id を黙って上書きしないためのガード
// (CONNECT_ID_ALREADY_DECLARED)はそのまま残し、拡張はこの別入口で受ける。
//
// 書くのは1ファイルだけなので、connectParts / connectBand のような巻き戻しは要らない。
export async function extendJoin(
  options: ExtendJoinOptions
): Promise<LoadFileResult<ExtendedJoin>> {
  const loadedProjectResult = await loadProject(options.projectPath);

  if (!loadedProjectResult.ok) {
    return loadedProjectResult;
  }

  const { partFilePaths, projectFilePath } = loadedProjectResult.value.paths;
  const filePath = partFilePaths[options.role];

  if (filePath === undefined) {
    return connectBandError(
      "CONNECT_ROLE_NOT_FOUND",
      `role "${options.role}" の part が登録されていません。 / No part is registered for role "${options.role}".`,
      options.role,
      ["Check the role spelling, or add the part first with loom add."]
    );
  }

  // 既存の縫い目の台帳。1本でも part.loom が読めなければ ok:false で返る ── 側の枚数を数え損ねたまま
  // band 判定をすると誤った側を許してしまうので、不完全な台帳では判断しない。
  const inventory = await collectExistingJoins(options.projectPath);

  if (!inventory.ok) {
    return inventory;
  }

  const join = inventory.value.find((candidate) => candidate.id === options.id);

  if (join === undefined) {
    return connectBandError(
      "CONNECT_JOIN_NOT_FOUND",
      `join "${options.id}" はこのプロジェクトにありません。 / No join "${options.id}" exists in this project.`,
      options.id,
      [
        "Check the id with loom check, or create the seam first with loom connect <a> <b> --as <id> (or --to for a band)."
      ]
    );
  }

  // 参加者どうしで type が食い違っている縫い目は、「その縫い目が何か」の宣言が既に割れている
  // (Seamlint も SEAMLINT_CONNECTOR_TYPE_MISMATCH で seam request を組まない)。ここで代表値を継ぐと、
  // どちらに倒れるかが loomit.yml の並び順で決まってしまい、割れを黙って1枚ぶん広げることになる。
  if (join.types.length > 1) {
    return connectBandError(
      "CONNECT_JOIN_TYPE_CONFLICT",
      `join "${join.id}" の type が参加者間で食い違っています(${join.types.join(", ")})。継ぐ値を決められません。 / Join "${join.id}" declares conflicting types across its participants (${join.types.join(", ")}), so there is no type to inherit.`,
      join.id,
      [
        `Make every part that declares "${join.id}" use the same connector type, then join again. Until they agree, loom slnt check also refuses to build a seam request for it (SEAMLINT_CONNECTOR_TYPE_MISMATCH).`
      ]
    );
  }

  // 合印の数も、既に宣言されている値と食い違う値は書かせない。同じ縫い目なら合印の数も同じはずで、
  // 割れていると createGeometryRequest は notch 署名そのものを渡さない
  // (SEAMLINT_CONNECTOR_NOTCH_COUNT_MISMATCH)。署名が落ちると、同じ2 BLOCK を共有する複数 seam を
  // Seamlint が辺ごとに区別できなくなる ── 書けてしまうと「宣言はしたのに識別に効かない」状態になる。
  const conflictingNotch = join.notchCounts.filter((count) => count !== options.notchCount);

  if (options.notchCount !== undefined && conflictingNotch.length > 0) {
    // **既にこの縫い目の中で合印数が割れているときは「この値に合わせろ」と言ってはいけない。** どの値を
    // 選んでも残りの値と食い違うので、案内どおり打ち直すたびに別の値を勧められて往復する。その場合は
    // 既存の宣言を先に揃えさせる。合わせられるのは、既存の宣言が1種類に定まっているときだけ。
    const fix =
      join.notchCounts.length > 1
        ? `This seam already declares different notch counts (${join.notchCounts.join(", ")}), so no value can match them all. Align connectors.${join.id}.notch_count across ${join.roles.join(", ")} first, then join.`
        : `Use --notches ${conflictingNotch[0]} to match, or omit --notches.`;

    return connectBandError(
      "CONNECT_NOTCH_COUNT_CONFLICT",
      `join "${join.id}" は既に別の合印数を宣言しているので、${options.notchCount} は書けません。 / Join "${join.id}" already declares a different notch count, so ${options.notchCount} cannot be written. (declared: ${join.notchCounts.join(", ")})`,
      `${options.role}.${join.id}.notch_count`,
      [
        `${fix} A seam has the same notches on every piece; a mismatch makes Loomit drop the notch signature entirely (SEAMLINT_CONNECTOR_NOTCH_COUNT_MISMATCH), so Seamlint can no longer tell this seam from others sharing the same pieces.`
      ]
    );
  }

  const sideResult = resolveExtendSide(join, options.side);

  if (!sideResult.ok) {
    return sideResult;
  }

  // 読み・検証は書き込み前にすべて済ませる。ここで既に role がその id を宣言していれば
  // CONNECT_ID_ALREADY_DECLARED になる(prepareSide が担当)。
  const prepared = await prepareSide(filePath, options.role, options.id, options.pathRef);

  if (!prepared.ok) {
    return prepared;
  }

  // type は既存の宣言から継ぐ。同じ縫い目なので種類も同じで、訊き直すと同一 seam で分類が割れる。
  const newPart = withConnector(
    prepared.value.part,
    options.id,
    join.type,
    prepared.value.pathRef,
    options.notchCount,
    sideResult.value
  );

  const validated = validatePart(newPart, options.role);

  if (!validated.ok) {
    return validated;
  }

  try {
    await writeFileAtomic(filePath, stringify(validated.value));
  } catch (error) {
    return { ok: false, diagnostics: [connectWriteError(error, filePath)] };
  }

  return {
    ok: true,
    value: {
      id: options.id,
      type: join.type,
      notchCount: options.notchCount,
      side: sideResult.value,
      added: {
        role: options.role,
        filePath,
        pathRef: prepared.value.pathRef,
        hasGeometrySource: prepared.value.hasGeometrySource,
        hasDxfGeometry: prepared.value.hasDxfGeometry
      },
      participants: [...join.roles, options.role],
      bandRole: bandRoleAfterExtend(join, sideResult.value, options.role),
      projectFilePath
    },
    diagnostics: []
  };
}

// 拡張時の side を決める(または拒否する)。返す値がそのまま connector に書かれる side。
//
// ここが「band を壊す追加」を止める関所。band 形が成立している縫い目では**1枚の側が band** なので、
// そこへ足すと両側とも複数枚になり band 形が消える(findBandShape が見つけられず
// SEAMLINT_CONNECTOR_SEAM_DEFERRED に落ちる)。しかも loom check は contiguous として健全のままなので、
// 診断では気づけない ── だから助言でなくここで拒否する。
function resolveExtendSide(
  join: ExistingJoin,
  requested: string | undefined
): LoadFileResult<string | undefined> {
  // side を1つも宣言していない縫い目 = coincident(重ね)。参加は id を宣言するだけで完結する。
  // ここに side を書くと classifyJoinSides が mixed と見て CONNECTOR_JOIN_SIDES_INCOMPLETE になる。
  if (join.sides.length === 0) {
    if (requested !== undefined) {
      return connectBandError(
        "CONNECT_SIDE_UNEXPECTED",
        `join "${join.id}" は側を持たない重ね(coincident)の縫い目なので、side は指定できません。 / Join "${join.id}" is a coincident (stacked) seam with no sides, so a side cannot be declared.`,
        join.id,
        [
          "Drop --side. A stacked seam pairs on the shared id alone; adding a side to one participant would make the seam's sides incomplete."
        ]
      );
    }

    return { ok: true, value: undefined, diagnostics: [] };
  }

  const declaredCount = join.sides.reduce((total, side) => total + side.roles.length, 0);
  const knownSides = join.sides.map((side) => side.side).join(", ");

  // 側を宣言していない参加者が混ざっている(mixed)、または側が3つ以上。どちらも1枚足しても健全にならない
  // ので、壊れた構成を広げさせず先に直させる。**側が1つだけ(one-side)はここに含めない** ── そちらは
  // 「2つ目の側がまだ無い」だけで、参加者を1枚足して反対側を宣言すれば contiguous が完成する。
  if (declaredCount !== join.roles.length || join.sides.length > 2) {
    // 詳細(reason)は**英語のみ**。日英併記の文を閉じたあとに括弧で1回だけ足す ── ここを併記にすると
    // `日本語 / English (日本語 / English)` と区切りが2つ出て、日英の切れ目が読めなくなる
    // (testing-diagnostics の「Messages that carry a detail」)。
    const reason =
      join.sides.length > 2
        ? `it declares ${join.sides.length} sides`
        : "some participants declare no side";

    return connectBandError(
      "CONNECT_JOIN_SIDES_UNHEALTHY",
      `join "${join.id}" の側の宣言が健全でないため、参加者を足せません。 / Join "${join.id}" does not have a healthy set of sides, so a participant cannot be added. (${reason})`,
      join.id,
      [
        "A contiguous seam needs exactly two sides with every participant on one of them. Fix the sides (loom check reports them) before adding a piece."
      ]
    );
  }

  if (requested === undefined) {
    // 側が1つだけなら、2つ目を名付けて完成させる道も案内する(既存の側しか出さないと、片側しか無い
    // 縫い目を完成させる手が無いように読める)。
    const choices =
      join.sides.length === 1
        ? `"${knownSides}", or a new label for the second side`
        : `one of: ${knownSides}`;

    return connectBandError(
      "CONNECT_SIDE_REQUIRED",
      `join "${join.id}" は側を持つ縫い目なので、どちらの側に属すかの指定が必要です。 / Join "${join.id}" is a seam with sides, so the new participant must declare which side it belongs to.`,
      join.id,
      [
        `Pass --side with ${choices}. Loomit does not guess: a side says which unit the piece belongs to, and only the author knows.`
      ]
    );
  }

  // 側が1つだけの縫い目は、まだ contiguous として不完全。ここに足す参加者が2つ目の側を名乗れば完成し、
  // 同じ側を名乗れば不完全なまま(loom check がそう報告する)。どちらも正当な途中経過なので通す。
  // 側ラベルの文字列自体に意味は無い(classifyJoinSides は distinct な数だけを見る)ので、新しい名前を
  // 受け付けても打ち間違いで壊れるものは無い。
  if (join.sides.length === 1) {
    return { ok: true, value: requested, diagnostics: [] };
  }

  const target = join.sides.find((side) => side.side === requested);

  if (target === undefined) {
    return connectBandError(
      "CONNECT_SIDE_UNKNOWN",
      `join "${join.id}" に側 "${requested}" はありません。 / Join "${join.id}" has no side "${requested}".`,
      `${join.id}.${requested}`,
      [
        `Use one of the sides this seam already declares: ${knownSides}. A third side would make the seam join three units.`
      ]
    );
  }

  const shape = resolveBandShape(
    join.sides.map((side) => ({ side: side.side, size: side.roles.length })),
    join.roles.length
  );

  // band が確定している縫い目で、その band 側に足そうとした。band は定義上ちょうど1枚。
  if (shape.kind === "band" && requested === shape.bandSide) {
    const bandRole = target.roles.join(", ");

    return connectBandError(
      "CONNECT_BAND_SIDE_LOCKED",
      `join "${join.id}" の側 "${requested}" は band(${bandRole})で、band はちょうど1枚でなければなりません。 / Side "${requested}" of join "${join.id}" is the band (${bandRole}), and a band must stay exactly one piece.`,
      `${join.id}.${requested}`,
      [
        `Add to side "${shape.neighbourSide}" instead. Growing the band side leaves both sides with several pieces, so Loomit can no longer emit the band-seam check and the seam's length is never measured.`
      ]
    );
  }

  return { ok: true, value: requested, diagnostics: [] };
}

// 足した後に band になる role(決まらなければ undefined)。band 形は「ちょうど1枚で残った側」で決まるので、
// 1枚ずつの側に3枚目を足した場合は**足さなかった側**が band になる。Loomit はどちらが物理的な band かを
// 保持していないため検証できない ── 確定した結果を返して、呼び出し側が作者に見せられるようにする。
function bandRoleAfterExtend(
  join: ExistingJoin,
  side: string | undefined,
  role: string
): string | undefined {
  if (side === undefined) {
    return undefined;
  }

  const sizes = join.sides.map((entry) => ({
    side: entry.side,
    size: entry.side === side ? entry.roles.length + 1 : entry.roles.length
  }));

  // 既存に無い側を名乗った(片側だけの縫い目に2つ目の側を足して完成させる)場合、その側に居るのは
  // この1枚だけ。勘定に入れないと側が1つのままに見えて band を見落とす。
  if (!join.sides.some((entry) => entry.side === side)) {
    sizes.push({ side, size: 1 });
  }

  const shape = resolveBandShape(sizes, join.roles.length + 1);

  if (shape.kind !== "band") {
    return undefined;
  }

  // 既にあった側に足した場合その側は2枚以上になるので band にはなれない ── band 側が今回名乗った側と
  // 一致するのは「新しい側にこの1枚だけが居る」ときだけで、そのとき band は足したパーツ自身。
  if (shape.bandSide === side) {
    return role;
  }

  return join.sides.find((entry) => entry.side === shape.bandSide)?.roles[0];
}

// band の入口検証で使う error 結果(false ブランチ)を1行で作る。
function connectBandError(
  code: RegisteredDiagnosticCode,
  message: string,
  target: string,
  suggestion: readonly string[]
): { readonly ok: false; readonly diagnostics: readonly Diagnostic[] } {
  return {
    ok: false,
    diagnostics: [createDiagnostic({ severity: "error", code, message, target, suggestion: [...suggestion] })]
  };
}

interface BandPreparedEntry {
  readonly role: string;
  readonly filePath: string;
  readonly side: string;
  readonly prepared: PreparedSide;
}

interface BandValidatedEntry {
  readonly role: string;
  readonly filePath: string;
  readonly originalText: string;
  readonly pathRef: string | undefined;
  readonly hasGeometrySource: boolean;
  readonly hasDxfGeometry: boolean;
  readonly part: Part;
}

interface PreparedSide {
  readonly part: Part;
  readonly originalText: string;
  readonly pathRef: string | undefined;
  readonly hasGeometrySource: boolean;
  readonly hasDxfGeometry: boolean;
}

// 片側の part.loom を読み、既存衝突を確認し、path_ref の既定(files.piece)を解決する。書き込みはしない。
async function prepareSide(
  filePath: string,
  role: string,
  id: string,
  pathRefOverride: string | undefined
): Promise<LoadFileResult<PreparedSide>> {
  // 巻き戻し用に生バイト列を先に取る(schema 再シリアライズでは元の書式を厳密には復元できないため)。
  const rawResult = await readText(filePath);

  if (!rawResult.ok) {
    return rawResult;
  }

  const partResult = await loadPartFile(filePath);

  if (!partResult.ok) {
    return partResult;
  }

  const part = partResult.value;

  // 既存 connector を黙って上書きしない。同じ id が既にあるなら別 id を促す(縫い直しは編集 or 別 id)。
  if (part.connectors?.[id] !== undefined) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "CONNECT_ID_ALREADY_DECLARED",
          message: `パーツ "${role}" はすでにコネクタ "${id}" を宣言しています。 / Part "${role}" already declares a connector "${id}".`,
          target: `${role}.${id}`,
          suggestion: [
            `Use a different --as id, or edit ${role}'s part.loom if you meant to change the existing connector.`
          ]
        })
      ]
    };
  }

  // path_ref の既定は files.piece(= DXF export の BLOCK 名)。override があればそれを使う。
  const pathRef = pathRefOverride ?? part.files?.piece;
  const hasGeometrySource = part.files?.geometry !== undefined || part.files?.preview !== undefined;
  const hasDxfGeometry = part.files?.geometry !== undefined;

  return {
    ok: true,
    value: { part, originalText: rawResult.value, pathRef, hasGeometrySource, hasDxfGeometry },
    diagnostics: []
  };
}

// 2つのパスが同じ物理ファイルを指すか。まず文字列一致(I/O なしの速い道・未作成でも成立)を見て、違えば
// dev+ino で突き合わせる。これで case-insensitive FS(Windows/macOS の Front vs front)や symlink/hardlink 跨ぎの
// 同一実ファイルも拾える。どちらかが stat できない(未作成など)ときは「同一でない」とみなし、後続の prepareSide に
// 本来の read エラーを出させる(存在しないことを「同一ファイル」で覆い隠さない)。ino が取れない FS(0)では
// 別ファイルを誤って同一扱いしないよう、ino が非0のときだけ dev+ino 一致を同一と判定する(安全側=誤検出を避ける)。
async function isSamePhysicalFile(pathA: string, pathB: string): Promise<boolean> {
  if (pathA === pathB) {
    return true;
  }

  try {
    const [a, b] = await Promise.all([
      stat(pathA, { bigint: true }),
      stat(pathB, { bigint: true })
    ]);
    return a.ino !== 0n && a.dev === b.dev && a.ino === b.ino;
  } catch {
    return false;
  }
}

// 既存 part に connector を1つ足した新しい Part を返す(元は破壊しない)。type/side/path_ref/notch_count のうち
// 与えられたものだけを載せる(identity だけの connector も許す=path_ref/notch_count は後で足せる)。side は band
// (contiguous)を書くときだけ載る ── pairwise の素の seam は side なし(coincident)のまま。
function withConnector(
  part: Part,
  id: string,
  type: string,
  pathRef: string | undefined,
  notchCount: number | undefined,
  side: string | undefined
): Part {
  const connector: Connector = {
    type,
    ...(side === undefined ? {} : { side }),
    ...(pathRef === undefined ? {} : { path_ref: pathRef }),
    ...(notchCount === undefined ? {} : { notch_count: notchCount })
  };

  return {
    ...part,
    connectors: {
      ...(part.connectors ?? {}),
      [id]: connector
    }
  };
}

function validatePart(part: Part, role: string): LoadFileResult<Part> {
  const parsed = partSchema.safeParse(part);

  if (!parsed.success) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "CONNECT_SCHEMA_INVALID",
          message: `更新後の "${role}" の part.loom が schema に合っていません。 / The updated part.loom for "${role}" does not match the schema.`,
          target: `parts.${role}`,
          suggestion: [parsed.error.issues.map((issue) => issue.message).join("; ")]
        })
      ]
    };
  }

  return { ok: true, value: parsed.data, diagnostics: [] };
}

function connectWriteError(error: unknown, filePath: string): Diagnostic {
  return describeFsError(error, {
    code: "CONNECT_WRITE_FAILED",
    message:
      "コネクタを part.loom に書き込めませんでした。 / Could not write the connector into the part.loom.",
    target: filePath,
    suggestion: ["Check filesystem permissions for the part directory."]
  });
}
