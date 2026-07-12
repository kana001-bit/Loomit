import { stringify } from "yaml";

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
  // 縫い合わせる2パーツの role(loomit.yml の parts キー)。connector は cross-part 専用なので相異なる必要がある。
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
          message: `Cannot connect part "${options.roleA}" to itself; a connector joins two different parts.`,
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
          message: `Connector id "${options.id}" is not usable: it must be a single token without "/", "\\", ":", ".", or "__" (and not "." or "..").`,
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
          message: `No part is registered for role ${missingRoles.map((role) => `"${role}"`).join(" or ")}.`,
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
  // 結果にならないのに成功扱いになる。connector は異なる2パーツを繋ぐものなので、file 同一性で明示的に弾く。
  // (roleA === roleB は上で弾いているが、別名で同一ファイルを指すケースはそこを通り抜ける。)
  if (filePathA === filePathB) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "CONNECT_SAME_FILE",
          message: `Roles "${options.roleA}" and "${options.roleB}" resolve to the same part.loom, so they are one physical part; a connector joins two distinct parts.`,
          target: filePathA,
          suggestion: [
            "Point each role at its own part.loom in loomit.yml, or connect two different parts."
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
    options.notchCount
  );
  const newPartB = withConnector(
    sideB.value.part,
    options.id,
    type,
    sideB.value.pathRef,
    options.notchCount
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
            message: `Wrote connector "${options.id}" to "${options.roleA}" but could not write "${options.roleB}" or undo "${options.roleA}", so only one side declares the seam.`,
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
          hasGeometrySource: sideA.value.hasGeometrySource
        },
        {
          role: options.roleB,
          filePath: filePathB,
          pathRef: sideB.value.pathRef,
          hasGeometrySource: sideB.value.hasGeometrySource
        }
      ],
      projectFilePath
    },
    diagnostics: []
  };
}

interface PreparedSide {
  readonly part: Part;
  readonly originalText: string;
  readonly pathRef: string | undefined;
  readonly hasGeometrySource: boolean;
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
          message: `Part "${role}" already declares a connector "${id}".`,
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

  return {
    ok: true,
    value: { part, originalText: rawResult.value, pathRef, hasGeometrySource },
    diagnostics: []
  };
}

// 既存 part に connector を1つ足した新しい Part を返す(元は破壊しない)。type/path_ref/notch_count のうち
// 与えられたものだけを載せる(identity だけの connector も許す=path_ref/notch_count は後で足せる)。
function withConnector(
  part: Part,
  id: string,
  type: string,
  pathRef: string | undefined,
  notchCount: number | undefined
): Part {
  const connector: Connector = {
    type,
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
          message: `The updated part.loom for "${role}" does not match the schema.`,
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
    message: "Could not write the connector into the part.loom.",
    target: filePath,
    suggestion: ["Check filesystem permissions for the part directory."]
  });
}
