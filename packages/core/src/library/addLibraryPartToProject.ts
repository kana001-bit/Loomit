import { access, cp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { stringify } from "yaml";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { describeFsError } from "../filesystem/fsError.js";
import { isPathWithin, isSafePathSegment } from "../filesystem/pathWithin.js";
import { writeFileAtomic } from "../filesystem/writeFileAtomic.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";
import { loadPartFile } from "../parts/loadPartFile.js";
import { loadProject } from "../project/loadProject.js";
import type { Part } from "../schema/part.schema.js";
import type { Project } from "../schema/project.schema.js";
import { loadLibraryMetaFile } from "./loadLibraryMeta.js";
import type { LibraryMeta } from "../schema/library-meta.schema.js";

export interface AddLibraryPartToProjectOptions {
  readonly libraryRoot: string;
  readonly projectPath: string;
  readonly type: string;
  readonly name: string;
  readonly role?: string;
  readonly localName?: string;
  readonly replace?: boolean;
}

export interface AddedLibraryPart {
  readonly project: Project;
  readonly part: Part;
  readonly meta: LibraryMeta;
  readonly role: string;
  readonly sourcePartDirectory: string;
  readonly targetPartDirectory: string;
  readonly projectPartPath: string;
  readonly projectFilePath: string;
}

export async function addLibraryPartToProject(
  options: AddLibraryPartToProjectOptions
): Promise<LoadFileResult<AddedLibraryPart>> {
  const loadedProjectResult = await loadProject(options.projectPath);

  if (!loadedProjectResult.ok) {
    return loadedProjectResult;
  }

  const libraryRoot = resolve(options.libraryRoot);
  const libraryPartDirectory = resolve(
    libraryRoot,
    getLibraryTypeDirectory(options.type),
    options.name
  );

  // type/name は CLI 引数由来でディレクトリ segment として使う。ファイルに触る前に、library root の
  // 外を読みにいくものを拒否する。
  if (!isPathWithin(libraryRoot, libraryPartDirectory)) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "LIBRARY_ADD_SOURCE_ESCAPES_ROOT",
          message: "The library part reference would read outside the library root.",
          target: libraryPartDirectory,
          suggestion: ["Use a plain type and name without path separators, \"..\", or an absolute path."]
        })
      ]
    };
  }

  const metaResult = await loadLibraryMetaFile(join(libraryPartDirectory, "meta.yml"));

  if (!metaResult.ok) {
    return metaResult;
  }

  const partResult = await loadPartFile(join(libraryPartDirectory, "part.loom"));

  if (!partResult.ok) {
    return partResult;
  }

  const part = partResult.value;
  const role = options.role ?? part.type;
  const localName = options.localName ?? options.name;

  // role と localName は loomit.yml に role key と project 相対パスとして書き込まれる。書き込み前に
  // segment でない値(例: "nested/role" や "..")を拒否し、コマンドが成功しつつ schema が読めない
  // project ファイルを生む状態を防ぐ。
  for (const segment of [
    { field: "role", value: role },
    { field: "name", value: localName }
  ]) {
    if (!isSafePathSegment(segment.value)) {
      return {
        ok: false,
        diagnostics: [
          createDiagnostic({
            severity: "error",
            code: "PROJECT_PART_SEGMENT_INVALID",
            message: `Project part ${segment.field} must be a single path segment.`,
            target: segment.value,
            suggestion: [
              `Use a ${segment.field} without path separators, "..", or an absolute path.`
            ]
          })
        ]
      };
    }
  }

  const targetPartDirectory = resolve(
    loadedProjectResult.value.paths.projectRoot,
    "parts",
    role,
    localName
  );
  const projectPartPath = toProjectPartPath(role, localName);
  const existingRolePath = loadedProjectResult.value.project.parts[role];

  if (existingRolePath !== undefined && options.replace !== true) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "PROJECT_PART_ROLE_ALREADY_EXISTS",
          message: `Project already has a part for role "${role}".`,
          target: `parts.${role}`,
          suggestion: ["Pass --replace to update the project role to the imported library part."]
        })
      ]
    };
  }

  // role/localName はディレクトリ segment として使う。import 先を project root 配下に保ち、そこから
  // 抜け出す ".."・区切り文字・絶対パスを拒否する。
  if (!isPathWithin(loadedProjectResult.value.paths.projectRoot, targetPartDirectory)) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "PROJECT_PART_TARGET_ESCAPES_ROOT",
          message: "The import target would write outside the project root.",
          target: targetPartDirectory,
          suggestion: ["Use a plain role and --as name without path separators, \"..\", or an absolute path."]
        })
      ]
    };
  }

  if (isPathWithin(libraryPartDirectory, targetPartDirectory)) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "LIBRARY_ADD_TARGET_INSIDE_LIBRARY_PART",
          message: "Project copy target cannot be inside the source library part.",
          target: targetPartDirectory,
          suggestion: ["Choose a project directory outside the library part directory."]
        })
      ]
    };
  }

  if (await pathExists(targetPartDirectory)) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "PROJECT_PART_ALREADY_EXISTS",
          message: "A project part directory already exists at the import target.",
          target: targetPartDirectory,
          suggestion: ["Choose another --as name, or remove the existing project part directory."]
        })
      ]
    };
  }

  const project: Project = {
    ...loadedProjectResult.value.project,
    parts: {
      ...loadedProjectResult.value.project.parts,
      [role]: projectPartPath
    }
  };

  try {
    await mkdir(join(loadedProjectResult.value.paths.projectRoot, "parts", role), {
      recursive: true
    });
    await cp(libraryPartDirectory, targetPartDirectory, {
      recursive: true,
      force: false,
      errorOnExist: true
    });
    await writeFileAtomic(loadedProjectResult.value.paths.projectFilePath, stringify(project));
  } catch (error) {
    // コピー済みの part を巻き戻し、loomit.yml 書き込み失敗で project ファイルが参照しない孤児の part
    // ディレクトリを残さない。target はこの呼び出しの前には存在しなかった(上でガード済み)。
    await rm(targetPartDirectory, { recursive: true, force: true }).catch(() => undefined);

    return {
      ok: false,
      diagnostics: [
        describeFsError(error, {
          code: "LIBRARY_ADD_FAILED",
          message: "Could not add the library part to the project.",
          target: targetPartDirectory,
          suggestion: ["Check the library path, project path, and filesystem permissions."]
        })
      ]
    };
  }

  return {
    ok: true,
    value: {
      project,
      part,
      meta: metaResult.value,
      role,
      sourcePartDirectory: libraryPartDirectory,
      targetPartDirectory,
      projectPartPath,
      projectFilePath: loadedProjectResult.value.paths.projectFilePath
    },
    diagnostics: []
  };
}

function toProjectPartPath(role: string, localName: string): string {
  return `./parts/${role}/${localName}/part.loom`;
}

function getLibraryTypeDirectory(type: string): string {
  if (type.endsWith("y")) {
    return `${type.slice(0, -1)}ies`;
  }

  return `${type}s`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
