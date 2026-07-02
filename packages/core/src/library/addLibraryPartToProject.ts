import { access, cp, mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { stringify } from "yaml";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
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

  const libraryPartDirectory = resolve(
    options.libraryRoot,
    getLibraryTypeDirectory(options.type),
    options.name
  );
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

  if (isSameOrChildPath(libraryPartDirectory, targetPartDirectory)) {
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
    await writeFile(loadedProjectResult.value.paths.projectFilePath, stringify(project), "utf8");
  } catch {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
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

function isSameOrChildPath(parentPath: string, candidatePath: string): boolean {
  const relativePath = relative(parentPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
