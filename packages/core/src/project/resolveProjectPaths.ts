import { join, resolve } from "node:path";

import type { Project } from "../schema/project.schema.js";

export interface ResolvedProjectPaths {
  readonly projectRoot: string;
  readonly projectFilePath: string;
  readonly partFilePaths: Readonly<Record<string, string>>;
}

export function resolveProjectPaths(projectRoot: string, project: Project): ResolvedProjectPaths {
  const resolvedProjectRoot = resolve(projectRoot);

  return {
    projectRoot: resolvedProjectRoot,
    projectFilePath: join(resolvedProjectRoot, "loomit.yml"),
    partFilePaths: resolvePartFilePaths(resolvedProjectRoot, project)
  };
}

function resolvePartFilePaths(
  projectRoot: string,
  project: Project
): Readonly<Record<string, string>> {
  const partFilePaths: Record<string, string> = {};

  for (const [role, partPath] of Object.entries(project.parts)) {
    partFilePaths[role] = resolve(projectRoot, partPath);
  }

  return partFilePaths;
}
