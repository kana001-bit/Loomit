import { access, copyFile, mkdir, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { stringify } from "yaml";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { describeFsError } from "../filesystem/fsError.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";
import { isPathWithin, isSafePathSegment } from "../filesystem/pathWithin.js";
import { writeFileAtomic } from "../filesystem/writeFileAtomic.js";
import { loadProject } from "../project/loadProject.js";
import { partSchema } from "../schema/part.schema.js";
import type { Connector, Part } from "../schema/part.schema.js";
import type { Project } from "../schema/project.schema.js";

// 対話ウィザード(CLI 側)が集めた回答を受け取り、part.loom を「生成」する純粋な書き込み。ここには
// prompt を持ち込まない(core / CLI 分離: 対話は CLI、決定済みの値からの生成は core)。ユーザーは .val を
// 置くだけで part.loom を手書きしなくてよい、という設計を成立させる入口。
export interface AddPartConnectorInput {
  // record key かつ connector.type として使う seam の識別子(例: "armhole")。
  readonly id: string;
  // 仕上がり線上の長さ(mm)。幾何の測定値であり scaffold 時は未測定(undefined)を許す。
  // 値は .val を評価して初めて出る計算値なので、ここでは人が知っている場合だけ受け取り、
  // 無ければ Valentina / seamlint / truer が後で埋める(connectorSchema も length_mm を optional にした)。
  readonly lengthMm?: number;
}

export interface AddPartToProjectOptions {
  // project を探す起点(通常は cwd)。ここから loomit.yml を見つけて parts に登録する。
  readonly projectPath: string;
  // 取り込む .val のパス(呼び手が cwd 基準で解決済みの絶対パスを渡す)。
  readonly valPath: string;
  // part.loom のラベル(name)。パスにもキーにも使わないので、日本語/空白を含む自由文字列でよい。
  readonly name: string;
  // project 側の part identity(front / back など)。loomit.yml の parts key かつ parts/<role>/ の
  // ディレクトリ segment になる。省略時は type を role として使う(旧来の 1 .val=1 part 経路)。
  readonly role?: string;
  // garment 上の粗分類(body / sleeve など)。role とは別軸で、同じ type のピースが複数あってよい。
  readonly type: string;
  readonly variant: string;
  // 共有 .val 内のどの <detail> ピースかを指す名前。1 .val→N part のとき各 part がこれで自分の担当を指す。
  readonly piece?: string;
  // parts/ 内から取り込むとき、通常は元 .val を「取り込み後に削除(= 実質 move)」して重複を残さない。
  // だが 1 .val→N part の途中ピースでは、後続ピースが同じ元 .val を必要とするため消してはいけない。
  // true のとき削除をスキップし、呼び手(CLI)が最後のピースだけに消費させられるようにする。
  readonly keepSource?: boolean;
  readonly connectors?: readonly AddPartConnectorInput[];
}

export interface AddedPart {
  readonly project: Project;
  readonly part: Part;
  // loomit.yml に登録した role。project の part スロット(front / back)を表す。
  readonly role: string;
  // part.loom の name(ラベル)。
  readonly name: string;
  readonly partDirectory: string;
  readonly partFilePath: string;
  readonly sourceFilePath: string;
  readonly projectPartPath: string;
  readonly projectFilePath: string;
}

export async function addPartToProject(
  options: AddPartToProjectOptions
): Promise<LoadFileResult<AddedPart>> {
  const loadedProjectResult = await loadProject(options.projectPath);

  if (!loadedProjectResult.ok) {
    return loadedProjectResult;
  }

  // role は project の part identity(front / back)で、loomit.yml の parts key かつ parts/<role>/ の
  // ディレクトリ segment になる。type(body / sleeve)とは別軸: 実データでは同じ type のピースが複数あり、
  // 「1 type = 1 part」だと 2 枚目が登録できなかった。role を明示できるようにして分離した(案B)。
  // role 未指定なら type を role として使う(旧来の 1 .val=1 part 経路との後方互換)。ファイルに触る前に、
  // 区切り文字や ".." を含む role(project root の外を指しうる)を弾く。
  const role = options.role ?? options.type;

  if (!isSafePathSegment(role)) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "PART_ADD_SEGMENT_INVALID",
          message: "Project part role must be a single path segment.",
          target: role,
          suggestion: ["Use a role without path separators, \"..\", or an absolute path."]
        })
      ]
    };
  }

  const { projectRoot, projectFilePath } = loadedProjectResult.value.paths;
  const valPath = resolve(options.valPath);
  const valBasename = basename(valPath);

  const missingSource = await checkValSourceExists(valPath);

  if (missingSource !== undefined) {
    return { ok: false, diagnostics: [missingSource] };
  }

  const partDirectory = resolve(projectRoot, "parts", role);
  const partFilePath = join(partDirectory, "part.loom");
  const sourceFilePath = join(partDirectory, valBasename);
  const projectPartPath = `./parts/${role}/part.loom`;

  // parts/<role>/ は project root 配下でなければならない(segment 検証済みだが二重の安全策)。
  if (!isPathWithin(projectRoot, partDirectory)) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "PART_ADD_TARGET_ESCAPES_ROOT",
          message: "The part target would write outside the project root.",
          target: partDirectory,
          suggestion: ["Use a role without path separators, \"..\", or an absolute path."]
        })
      ]
    };
  }

  // 既存 part を黙って上書きしない。role の重複、ディレクトリの既存はどちらもエラーにする。
  // project は role ごとに1つの part を持つ(resolveParts が role をキーにする)ため、同じ role の
  // 二重登録はここで弾く(type が同じでも role が違えば別 part として共存できる)。
  if (loadedProjectResult.value.project.parts[role] !== undefined) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "PART_ADD_ALREADY_REGISTERED",
          message: `Project already has a part for role "${role}".`,
          target: `parts.${role}`,
          suggestion: ["Choose another role, or edit the existing part."]
        })
      ]
    };
  }

  if (await pathExists(partDirectory)) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "PART_ADD_DIRECTORY_EXISTS",
          message: "A part directory already exists at the target.",
          target: partDirectory,
          suggestion: ["Choose another role, or remove the existing part directory."]
        })
      ]
    };
  }

  const partResult = buildPart(options, valBasename, role);

  if (!partResult.ok) {
    return partResult;
  }

  const part = partResult.value;
  const project: Project = {
    ...loadedProjectResult.value.project,
    parts: {
      ...loadedProjectResult.value.project.parts,
      [role]: projectPartPath
    }
  };

  // 取り込み元 .val が parts/ の中にあるかを、書き込みを始める前に確定させる。中にあれば「取り込み後に
  // 元を削除(= 実質 move)」して重複を残さない(check が「未登録の .val」と咎める状態を作らない)。
  // parts/ の外(Downloads や共有フォルダ)から取り込むときは元を残す(コピー)。keepSource が立って
  // いる間は消さない(1 .val→N part の途中ピース。後続が同じ元を必要とするため最後のピースまで残す)。
  const consumeSource =
    options.keepSource !== true && isPathWithin(resolve(projectRoot, "parts"), valPath);

  try {
    await mkdir(partDirectory, { recursive: true });
    // .val は part ディレクトリへコピーする。誤って上書きしないよう既存があれば失敗させる。
    await copyFile(valPath, sourceFilePath);
    await writeFileAtomic(partFilePath, stringify(part));
    // loomit.yml は最後に書く。ここまでで失敗したら下の catch で part ディレクトリを巻き戻す。
    await writeFileAtomic(projectFilePath, stringify(project));
  } catch (error) {
    // 生成した part ディレクトリだけを巻き戻す(上のガードで実行前には存在しなかったことを確認済み)。
    // loomit.yml を参照だけ増やして実体が無い、という半端な状態を残さない。
    await rm(partDirectory, { recursive: true, force: true }).catch(() => undefined);

    return {
      ok: false,
      diagnostics: [
        describeFsError(error, {
          code: "PART_ADD_FAILED",
          message: "Could not add the part to the project.",
          target: partDirectory,
          suggestion: ["Check the .val path, project path, and filesystem permissions."]
        })
      ]
    };
  }

  // part.loom と loomit.yml を書けた時点で add は成功。取り込み元が parts/ 内なら、ここで初めて元 .val を
  // 削除する。ロールバック(上の catch の rm)の後に置くことで、途中失敗で唯一のコピーごと消す事故を防ぐ。
  // 削除に失敗しても add は成功のまま(元が残り、check が再度案内するだけ)。
  if (consumeSource) {
    await rm(valPath, { force: true }).catch(() => undefined);
  }

  return {
    ok: true,
    value: {
      project,
      part,
      role,
      name: options.name,
      partDirectory,
      partFilePath,
      sourceFilePath,
      projectPartPath,
      projectFilePath
    },
    diagnostics: []
  };
}

// 取り込む .val が存在するかを確認する。存在すれば undefined、無ければ診断を返す。CLI は対話を
// 始める前にこれを呼んで即座に失敗させ(全部入力させてから「無い」と言わない)、core も書き込み直前の
// 最終ガードとして同じものを使う。メッセージを1箇所に保つための共有ヘルパー。
export async function checkValSourceExists(valPath: string): Promise<Diagnostic | undefined> {
  const resolved = resolve(valPath);

  if (await pathExists(resolved)) {
    return undefined;
  }

  return createDiagnostic({
    severity: "error",
    code: "PART_ADD_SOURCE_NOT_FOUND",
    message: "The .val source to add was not found.",
    target: resolved,
    suggestion: ["Check the path to the .val file."]
  });
}

// 回答から Part を組み立て、書き込む前に正本 schema で検証する。CLI 側で弾ききれない値(例: 負の
// length_mm)があっても、schema に合わない part.loom を生成しないための最後の関所。piece があれば
// files.piece に載せ、どの <detail> を担当する part かを part.loom 自身に持たせる。
function buildPart(
  options: AddPartToProjectOptions,
  valBasename: string,
  role: string
): LoadFileResult<Part> {
  const connectors = buildConnectors(options.connectors);
  const draft = {
    schema: "loomit.part.v0",
    name: options.name,
    variant: options.variant,
    type: options.type,
    files: {
      source: valBasename,
      ...(options.piece === undefined ? {} : { piece: options.piece })
    },
    ...(connectors === undefined ? {} : { connectors })
  };

  const parsed = partSchema.safeParse(draft);

  if (!parsed.success) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "PART_ADD_SCHEMA_INVALID",
          message: "The generated part.loom does not match the schema.",
          target: `parts.${role}`,
          suggestion: [parsed.error.issues.map((issue) => issue.message).join("; ")]
        })
      ]
    };
  }

  return { ok: true, value: parsed.data, diagnostics: [] };
}

function buildConnectors(
  inputs: readonly AddPartConnectorInput[] | undefined
): Record<string, Connector> | undefined {
  if (inputs === undefined || inputs.length === 0) {
    return undefined;
  }

  const connectors: Record<string, Connector> = {};

  for (const input of inputs) {
    // 同じ seam を二重登録した場合は後勝ちにせず、最初の1件を残す(CLI 側でも重複は避けるが二重の安全策)。
    if (connectors[input.id] === undefined) {
      // length_mm は未測定なら載せない(identity だけの connector にする)。
      connectors[input.id] = {
        type: input.id,
        ...(input.lengthMm === undefined ? {} : { length_mm: input.lengthMm })
      };
    }
  }

  return connectors;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
