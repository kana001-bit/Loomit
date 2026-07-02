import { access, mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { stringify } from "yaml";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
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

  // `loom init` initializes in place (git init style), so the target directory is
  // expected to already exist. Guard on loomit.yml instead of the directory, so we
  // never clobber an existing Loomit project.
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

  try {
    await mkdir(projectRoot, { recursive: true });

    for (const directory of scaffoldDirectories) {
      await mkdir(join(projectRoot, directory), { recursive: true });
    }

    await writeFile(projectFilePath, stringify(project), "utf8");
  } catch {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
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
