import { join } from "node:path";

import { findProjectRoot } from "./findProjectRoot.js";
import { loadProjectFile } from "./loadProjectFile.js";
import { resolveProjectPaths } from "./resolveProjectPaths.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";
import type { Project } from "../schema/project.schema.js";
import type { ResolvedProjectPaths } from "./resolveProjectPaths.js";

export interface LoadedProject {
  readonly project: Project;
  readonly paths: ResolvedProjectPaths;
}

export async function loadProject(startPath: string): Promise<LoadFileResult<LoadedProject>> {
  const rootResult = await findProjectRoot(startPath);

  if (!rootResult.ok) {
    return rootResult;
  }

  const projectResult = await loadProjectFile(join(rootResult.value, "loomit.yml"));

  if (!projectResult.ok) {
    return projectResult;
  }

  return {
    ok: true,
    value: {
      project: projectResult.value,
      paths: resolveProjectPaths(rootResult.value, projectResult.value)
    },
    diagnostics: []
  };
}
