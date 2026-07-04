import { access, mkdir, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { stringify } from "yaml";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { describeFsError } from "../filesystem/fsError.js";
import { writeFileAtomic } from "../filesystem/writeFileAtomic.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";
import type { Project } from "../schema/project.schema.js";

export interface CreateProjectOptions {
  readonly targetPath: string;
  readonly name?: string;
  readonly garment?: string;
}

export interface CreatedProject {
  readonly project: Project;
  readonly projectRoot: string;
  readonly projectFilePath: string;
  readonly directories: readonly string[];
}

const scaffoldDirectories = ["parts", "notes", "profiles", "output"] as const;

export async function createProject(
  options: CreateProjectOptions
): Promise<LoadFileResult<CreatedProject>> {
  const projectRoot = resolve(options.targetPath);
  const projectName = options.name ?? basename(projectRoot);
  const projectFilePath = join(projectRoot, "loomit.yml");

  // `loom init` は(git init のように)その場で初期化するため、対象ディレクトリは既に存在している
  // 想定。ディレクトリではなく loomit.yml の有無で判定し、既存の Loomit プロジェクトを絶対に
  // 上書きしない。
  if (await pathExists(projectFilePath)) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "PROJECT_ALREADY_EXISTS",
          message:
            "この場所はすでに Loomit プロジェクトです。/ This location is already a Loomit project.",
          target: projectFilePath,
          suggestion: ["Run this in a directory without a loomit.yml, or remove the existing project file."]
        })
      ]
    };
  }

  const project: Project = {
    schema: "loomit.project.v0",
    name: projectName,
    garment: options.garment ?? "unspecified",
    parts: {},
    profiles: {},
    outputs: {
      dir: "./output"
    }
  };

  // この呼び出しが実際に作成したディレクトリだけを記録する。init は既存ディレクトリ内でも走る
  // (targetPath は事前に存在しうる)ため、失敗時は自分が作ったものだけを戻し、既存ディレクトリは
  // 決して消さない。mkdir(recursive) は新規作成した最上位のパスを返し、既存なら undefined を返すので
  // それで判定する(pathExists は access 失敗と「不在」を区別できず、既存を誤って削除する恐れがある)。
  const createdDirectories: string[] = [];

  try {
    for (const directory of [
      projectRoot,
      ...scaffoldDirectories.map((name) => join(projectRoot, name))
    ]) {
      const created = await mkdir(directory, { recursive: true });

      if (created !== undefined) {
        createdDirectories.push(created);
      }
    }

    await writeFileAtomic(projectFilePath, stringify(project));
  } catch (error) {
    // 自分が作ったものだけを深い順に削除し、失敗しても空の scaffold を残さない。
    for (const directory of [...createdDirectories].reverse()) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }

    return {
      ok: false,
      diagnostics: [
        describeFsError(error, {
          code: "PROJECT_CREATE_FAILED",
          message:
            "Loomit プロジェクトを作成できませんでした。/ Could not create the Loomit project.",
          target: projectRoot,
          suggestion: ["Check the target path and filesystem permissions."]
        })
      ]
    };
  }

  return {
    ok: true,
    value: {
      project,
      projectRoot,
      projectFilePath,
      directories: scaffoldDirectories.map((directory) => join(projectRoot, directory))
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
