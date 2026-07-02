import { access, cp, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { createDiagnosticReport } from "../diagnostics/report.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { DiagnosticReport } from "../diagnostics/report.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";
import type { ResolvedProject, ResolvedProjectPart } from "../project/resolveParts.js";

export type BuildAssetKind = "source" | "preview" | "print";

export interface BuildManifestAsset {
  readonly role: string;
  readonly partName: string;
  readonly kind: BuildAssetKind;
  readonly sourcePath: string;
  readonly outputPath: string;
}

export interface BuildManifest {
  readonly schema: "loomit.build_manifest.v0";
  readonly project: string;
  readonly garment: string;
  readonly assets: readonly BuildManifestAsset[];
}

export interface BuildReport extends DiagnosticReport {
  readonly outputDir: string;
  readonly manifestFilePath: string;
  readonly manifest?: BuildManifest;
}

interface PlannedBuildAsset extends BuildManifestAsset {
  readonly absoluteSourcePath: string;
  readonly absoluteOutputPath: string;
}

const buildAssetKinds = ["source", "preview", "print"] as const;

export async function buildProject(
  resolvedProject: ResolvedProject
): Promise<LoadFileResult<BuildReport>> {
  const outputDir = resolve(
    resolvedProject.paths.projectRoot,
    resolvedProject.project.outputs?.dir ?? "./output"
  );
  const manifestFilePath = join(outputDir, "manifest.json");
  const plannedAssets = planBuildAssets(
    resolvedProject,
    outputDir,
    resolvedProject.paths.projectRoot
  );
  const diagnostics = await validateBuildInputs(plannedAssets);

  if (diagnostics.length > 0) {
    return {
      ok: false,
      diagnostics
    };
  }

  const manifest: BuildManifest = {
    schema: "loomit.build_manifest.v0",
    project: resolvedProject.project.name,
    garment: resolvedProject.project.garment,
    assets: plannedAssets.map(toManifestAsset)
  };

  try {
    await mkdir(outputDir, { recursive: true });

    for (const asset of plannedAssets) {
      await mkdir(dirname(asset.absoluteOutputPath), { recursive: true });
      await cp(asset.absoluteSourcePath, asset.absoluteOutputPath, {
        force: true,
        errorOnExist: false
      });
    }

    await writeFile(manifestFilePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  } catch {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "BUILD_WRITE_FAILED",
          message: "Could not write Loomit build output.",
          target: outputDir,
          suggestion: ["Check output paths and filesystem permissions."]
        })
      ]
    };
  }

  const report = createBuildReport({
    outputDir,
    manifestFilePath,
    manifest
  });

  return {
    ok: true,
    value: report,
    diagnostics: report.diagnostics
  };
}

export function createBuildReport(input: {
  readonly diagnostics?: readonly Diagnostic[];
  readonly outputDir: string;
  readonly manifestFilePath: string;
  readonly manifest?: BuildManifest;
}): BuildReport {
  const report = createDiagnosticReport(input.diagnostics ?? []);

  return {
    ...report,
    outputDir: input.outputDir,
    manifestFilePath: input.manifestFilePath,
    ...(input.manifest === undefined ? {} : { manifest: input.manifest })
  };
}

function toManifestAsset(asset: PlannedBuildAsset): BuildManifestAsset {
  return {
    role: asset.role,
    partName: asset.partName,
    kind: asset.kind,
    sourcePath: asset.sourcePath,
    outputPath: asset.outputPath
  };
}

function planBuildAssets(
  resolvedProject: ResolvedProject,
  outputDir: string,
  projectRoot: string
): readonly PlannedBuildAsset[] {
  return Object.values(resolvedProject.parts).flatMap((part) =>
    planPartAssets(part, outputDir, projectRoot)
  );
}

function planPartAssets(
  resolvedPart: ResolvedProjectPart,
  outputDir: string,
  projectRoot: string
): readonly PlannedBuildAsset[] {
  const partDirectory = dirname(resolvedPart.filePath);
  const assets: PlannedBuildAsset[] = [];

  for (const kind of buildAssetKinds) {
    const filePath = resolvedPart.part.files?.[kind];

    if (filePath === undefined) {
      continue;
    }

    const absoluteSourcePath = resolve(partDirectory, filePath);
    const absoluteOutputPath = join(
      outputDir,
      "parts",
      resolvedPart.role,
      kind,
      basename(filePath)
    );

    assets.push({
      role: resolvedPart.role,
      partName: resolvedPart.part.name,
      kind,
      sourcePath: relative(projectRoot, absoluteSourcePath),
      outputPath: relative(projectRoot, absoluteOutputPath),
      absoluteSourcePath,
      absoluteOutputPath
    });
  }

  return assets;
}

async function validateBuildInputs(
  assets: readonly PlannedBuildAsset[]
): Promise<readonly Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  for (const asset of assets) {
    if (!(await pathExists(asset.absoluteSourcePath))) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "BUILD_INPUT_FILE_MISSING",
          message: "A part file referenced for build output does not exist.",
          target: asset.sourcePath,
          suggestion: [`Add the ${asset.kind} file, or update part files.${asset.kind}.`]
        })
      );
    }
  }

  return diagnostics;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
