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
import { isDelimiterSafeIdentifier } from "../schema/joinIdentifier.js";
import { partSchema } from "../schema/part.schema.js";
import type { Connector, Part } from "../schema/part.schema.js";
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
