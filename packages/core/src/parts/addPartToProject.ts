import { access, copyFile, mkdir, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { stringify } from "yaml";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { describeFsError } from "../filesystem/fsError.js";
import { isPathWithin, isSafePathSegment } from "../filesystem/pathWithin.js";
import { writeFileAtomic } from "../filesystem/writeFileAtomic.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";
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
  // 仕上がり線上の長さ(mm)。connectorSchema が length_mm を必須にするため回答が要る。
  readonly lengthMm: number;
}

export interface AddPartToProjectOptions {
  // project を探す起点(通常は cwd)。ここから loomit.yml を見つけて parts に登録する。
  readonly projectPath: string;
  // 取り込む .val のパス(呼び手が cwd 基準で解決済みの絶対パスを渡す)。
  readonly valPath: string;
  // part の識別名。parts/<name>/ ディレクトリ・part.loom の name・loomit.yml の parts key を兼ねる。
  readonly name: string;
  // garment 上の役割(body / sleeve など)。schema 上は安全な単一 segment。
  readonly type: string;
  readonly variant: string;
  readonly connectors?: readonly AddPartConnectorInput[];
}

export interface AddedPart {
  readonly project: Project;
  readonly part: Part;
  // loomit.yml に登録した role(= part.type)。project の part スロットを表す。
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

  // type は project の役割(role)であり、loomit.yml の parts key かつ parts/<type>/ のディレクトリ
  // segment になる。resolveParts が「role === part.type」を要求するため、key は type に一致させる
  // (name は part.loom のラベルで、パスにも key にも使わない)。ファイルに触る前に、区切り文字や
  // ".." を含む type(project root の外を指しうる)を弾く。
  const role = options.type;

  if (!isSafePathSegment(role)) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "PART_ADD_SEGMENT_INVALID",
          message: "Part type must be a single path segment. / part の type は単一のパスセグメントにしてください。",
          target: role,
          suggestion: ["Use a type without path separators, \"..\", or an absolute path."]
        })
      ]
    };
  }

  const { projectRoot, projectFilePath } = loadedProjectResult.value.paths;
  const valPath = resolve(options.valPath);
  const valBasename = basename(valPath);

  if (!(await pathExists(valPath))) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "PART_ADD_SOURCE_NOT_FOUND",
          message: "取り込む .val が見つかりません。 / The .val source to add was not found.",
          target: valPath,
          suggestion: ["Check the path to the .val file."]
        })
      ]
    };
  }

  const partDirectory = resolve(projectRoot, "parts", role);
  const partFilePath = join(partDirectory, "part.loom");
  const sourceFilePath = join(partDirectory, valBasename);
  const projectPartPath = `./parts/${role}/part.loom`;

  // parts/<type>/ は project root 配下でなければならない(segment 検証済みだが二重の安全策)。
  if (!isPathWithin(projectRoot, partDirectory)) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "PART_ADD_TARGET_ESCAPES_ROOT",
          message: "The part target would write outside the project root.",
          target: partDirectory,
          suggestion: ["Use a name without path separators, \"..\", or an absolute path."]
        })
      ]
    };
  }

  // 既存 part を黙って上書きしない。role(=type)の重複、ディレクトリの既存はどちらもエラーにする。
  // project は role ごとに1つの part を持つ(resolveParts が role をキーにする)ため、同じ type の
  // 二重登録はここで弾く。
  if (loadedProjectResult.value.project.parts[role] !== undefined) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "PART_ADD_ALREADY_REGISTERED",
          message: `Project already has a part for role "${role}". / role "${role}" の part がすでに登録されています。`,
          target: `parts.${role}`,
          suggestion: ["Choose another type, or edit the existing part."]
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
          message: "A part directory already exists at the target. / 生成先に part ディレクトリが既に存在します。",
          target: partDirectory,
          suggestion: ["Choose another name, or remove the existing part directory."]
        })
      ]
    };
  }

  const partResult = buildPart(options, valBasename);

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

  try {
    await mkdir(partDirectory, { recursive: true });
    // .val はコピーする(元ファイルは残す)。誤って上書きしないよう既存があれば失敗させる。
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
          message: "part の生成に失敗しました。 / Could not add the part to the project.",
          target: partDirectory,
          suggestion: ["Check the .val path, project path, and filesystem permissions."]
        })
      ]
    };
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

// 回答から Part を組み立て、書き込む前に正本 schema で検証する。CLI 側で弾ききれない値(例: 負の
// length_mm)があっても、schema に合わない part.loom を生成しないための最後の関所。
function buildPart(
  options: AddPartToProjectOptions,
  valBasename: string
): LoadFileResult<Part> {
  const connectors = buildConnectors(options.connectors);
  const draft = {
    schema: "loomit.part.v0",
    name: options.name,
    variant: options.variant,
    type: options.type,
    files: { source: valBasename },
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
          message: "生成しようとした part.loom が schema と一致しません。 / The generated part.loom does not match the schema.",
          target: `parts.${options.name}`,
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
      connectors[input.id] = { type: input.id, length_mm: input.lengthMm };
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
