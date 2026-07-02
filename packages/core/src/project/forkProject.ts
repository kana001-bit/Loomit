import { access, cp, writeFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { stringify } from "yaml";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";
import type { Project } from "../schema/project.schema.js";
import { loadProject } from "./loadProject.js";

export interface ForkProjectOptions {
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly name?: string;
}

export interface ForkedProject {
  readonly project: Project;
  readonly sourceProjectRoot: string;
  readonly targetProjectRoot: string;
  readonly projectFilePath: string;
}

export async function forkProject(
  options: ForkProjectOptions
): Promise<LoadFileResult<ForkedProject>> {
  const sourceResult = await loadProject(options.sourcePath);

  if (!sourceResult.ok) {
    return sourceResult;
  }

  const sourceProjectRoot = sourceResult.value.paths.projectRoot;
  const targetProjectRoot = resolve(options.targetPath);
  const targetProjectName = options.name ?? basename(targetProjectRoot);
  const targetProjectFilePath = resolve(targetProjectRoot, "loomit.yml");

  if (isSameOrChildPath(sourceProjectRoot, targetProjectRoot)) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "PROJECT_FORK_TARGET_INSIDE_SOURCE",
          message:
            "fork 先を fork 元プロジェクトの内側には作成できません。/ The fork target cannot be inside the source project.",
          target: targetProjectRoot,
          suggestion: ["Choose a target directory outside the source project."]
        })
      ]
    };
  }

  if (await pathExists(targetProjectRoot)) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "PROJECT_ALREADY_EXISTS",
          message:
            "fork 先のパスはすでに存在します。/ The fork target path already exists.",
          target: targetProjectRoot,
          suggestion: ["Choose a new directory, or remove the existing one before forking."]
        })
      ]
    };
  }

  const project: Project = {
    ...sourceResult.value.project,
    name: targetProjectName
  };

  try {
    await cp(sourceProjectRoot, targetProjectRoot, {
      recursive: true,
      force: false,
      errorOnExist: true
    });
    await writeFile(targetProjectFilePath, stringify(project), "utf8");
  } catch {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "PROJECT_FORK_FAILED",
          message: "Loomit プロジェクトを fork できませんでした。/ Could not fork the Loomit project.",
          target: targetProjectRoot,
          suggestion: ["Check the source path, target path, and filesystem permissions."]
        })
      ]
    };
  }

  return {
    ok: true,
    value: {
      project,
      sourceProjectRoot,
      targetProjectRoot,
      projectFilePath: targetProjectFilePath
    },
    diagnostics: []
  };
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
