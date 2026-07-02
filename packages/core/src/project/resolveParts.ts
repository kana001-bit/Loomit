import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { getStatusForDiagnostics } from "../diagnostics/report.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";
import { loadPartFile } from "../parts/loadPartFile.js";
import type { Part } from "../schema/part.schema.js";
import type { Project } from "../schema/project.schema.js";
import type { LoadedProject } from "./loadProject.js";
import type { ResolvedProjectPaths } from "./resolveProjectPaths.js";

export interface ResolvedProjectPart {
  readonly role: string;
  readonly filePath: string;
  readonly part: Part;
}

export interface ResolvedProject {
  readonly project: Project;
  readonly paths: ResolvedProjectPaths;
  readonly parts: Readonly<Record<string, ResolvedProjectPart>>;
}

export async function resolveParts(
  loadedProject: LoadedProject
): Promise<LoadFileResult<ResolvedProject>> {
  const diagnostics: Diagnostic[] = [];
  const parts: Record<string, ResolvedProjectPart> = {};

  for (const [role, filePath] of Object.entries(loadedProject.paths.partFilePaths)) {
    const partResult = await loadPartFile(filePath);

    if (!partResult.ok) {
      diagnostics.push(...partResult.diagnostics);
      continue;
    }

    diagnostics.push(...partResult.diagnostics);

    if (partResult.value.type !== role) {
      diagnostics.push(createPartRoleTypeMismatchDiagnostic(role, partResult.value));
    }

    parts[role] = {
      role,
      filePath,
      part: partResult.value
    };
  }

  if (getStatusForDiagnostics(diagnostics) === "error") {
    return {
      ok: false,
      diagnostics
    };
  }

  return {
    ok: true,
    value: {
      project: loadedProject.project,
      paths: loadedProject.paths,
      parts
    },
    diagnostics
  };
}

function createPartRoleTypeMismatchDiagnostic(role: string, part: Part): Diagnostic {
  return createDiagnostic({
    severity: "error",
    code: "PART_ROLE_TYPE_MISMATCH",
    message: `Project part role "${role}" points to a part with type "${part.type}".`,
    target: `parts.${role}`,
    suggestion: [`Use a part with type "${role}", or change the project role.`]
  });
}
