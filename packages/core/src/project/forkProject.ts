import { access, cp, rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { stringify } from "yaml";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { describeFsError } from "../filesystem/fsError.js";
import { isPathWithin } from "../filesystem/pathWithin.js";
import { writeFileAtomic } from "../filesystem/writeFileAtomic.js";
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

  if (isPathWithin(sourceProjectRoot, targetProjectRoot)) {
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

  // build の生成物は再生成可能で durable state ではないため、fork は source の(古い/巨大かもしれない)
  // output/ を新プロジェクトへ持ち込まない。
  const sourceOutputDir = resolve(
    sourceProjectRoot,
    sourceResult.value.project.outputs?.dir ?? "./output"
  );

  try {
    await cp(sourceProjectRoot, targetProjectRoot, {
      recursive: true,
      force: false,
      errorOnExist: true,
      filter: (source) => !isPathWithin(sourceOutputDir, source)
    });
    await writeFileAtomic(targetProjectFilePath, stringify(project));
  } catch (error) {
    // 途中まで作られた fork を巻き戻し、書き込み失敗時に source 名のままのプロジェクトを残さない。
    // target はこの呼び出しの前には存在しなかった(上でガード済み)ので、丸ごと削除する all-or-nothing
    // な rollback で安全。
    await rm(targetProjectRoot, { recursive: true, force: true }).catch(() => undefined);

    return {
      ok: false,
      diagnostics: [
        describeFsError(error, {
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
