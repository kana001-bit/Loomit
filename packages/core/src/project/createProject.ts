import { mkdir, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { stringify } from "yaml";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { describeFsError } from "../filesystem/fsError.js";
import { checkPathExistence } from "../filesystem/pathExists.js";
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
  // 上書きしない。access() の失敗を「無い」に潰すと、権限で読めない既存 loomit.yml を新規扱いで
  // 上書きしかねないので、errno を分類して確認できないときは失敗を返す(R3)。
  const projectExistence = await checkPathExistence(projectFilePath);

  if (projectExistence.kind === "inaccessible") {
    return {
      ok: false,
      diagnostics: [
        describeFsError(projectExistence.error, {
          code: "PROJECT_TARGET_UNREADABLE",
          message:
            "この場所が既存の Loomit プロジェクトか確認できませんでした。/ Could not determine whether this location is already a Loomit project.",
          target: projectFilePath,
          suggestion: ["Check the target path and filesystem permissions."]
        })
      ]
    };
  }

  if (projectExistence.kind === "exists") {
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
  // 決して消さない。存在確認してから mkdir する方式では、確認から作成までの間に他が作りうる(TOCTOU)。
  // mkdir(recursive) は新規作成した最上位のパスを返し既存なら undefined を返すので、その戻り値で
  // 「この呼び出しが作った」ものだけを確実に掴んで rollback 対象にする。
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
