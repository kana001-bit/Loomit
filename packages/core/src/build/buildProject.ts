import { cp, mkdir } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { createDiagnosticReport } from "../diagnostics/report.js";
import { describeFsError } from "../filesystem/fsError.js";
import { checkPathExistence } from "../filesystem/pathExists.js";
import { isPathWithin } from "../filesystem/pathWithin.js";
import { toPosixPath } from "../filesystem/toPosixPath.js";
import { writeFileAtomic } from "../filesystem/writeFileAtomic.js";
import { resolvePartFilePath } from "../parts/resolvePartFilePath.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { DiagnosticReport } from "../diagnostics/report.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";
import type { ResolvedProject, ResolvedProjectPart } from "../project/resolveParts.js";

export type BuildAssetKind = "source" | "preview" | "geometry" | "print";

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

const buildAssetKinds = ["source", "preview", "geometry", "print"] as const;

export async function buildProject(
  resolvedProject: ResolvedProject
): Promise<LoadFileResult<BuildReport>> {
  const outputDir = resolve(
    resolvedProject.paths.projectRoot,
    resolvedProject.project.outputs?.dir ?? "./output"
  );

  // outputs.dir は loomit.yml 由来。build の出力を project root 配下に保ち、紛れ込んだ "../.." が
  // project 外のファイルを build に上書きさせないようにする。
  if (!isPathWithin(resolvedProject.paths.projectRoot, outputDir)) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "BUILD_OUTPUT_ESCAPES_ROOT",
          message:
            "ビルド出力ディレクトリが project root の外を指しています。 / The build output directory is outside the project root.",
          target: outputDir,
          suggestion: ["Set outputs.dir to a project-relative path such as ./output."]
        })
      ]
    };
  }

  const manifestFilePath = join(outputDir, "manifest.json");
  const plannedAssets = planBuildAssets(
    resolvedProject,
    outputDir,
    resolvedProject.paths.projectRoot
  );
  const diagnostics = await validateBuildInputs(plannedAssets, {
    outputDir,
    projectRoot: resolvedProject.paths.projectRoot
  });

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

    await writeFileAtomic(manifestFilePath, `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        describeFsError(error, {
          code: "BUILD_WRITE_FAILED",
          message:
            "Loomit のビルド出力を書き込めませんでした。 / Could not write Loomit build output.",
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
  const assets: PlannedBuildAsset[] = [];

  for (const kind of buildAssetKinds) {
    const filePath = resolvedPart.part.files?.[kind];

    if (filePath === undefined) {
      continue;
    }

    const absoluteSourcePath = resolvePartFilePath({
      partFilePath: resolvedPart.filePath,
      value: filePath,
      projectRoot
    });
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
      // manifest.json は正本(durable)。保存・診断表示する相対パスは OS 非依存の POSIX 区切りにし、
      // Windows で書いた manifest を macOS / Linux でもそのまま解釈できるようにする。
      sourcePath: toPosixPath(relative(projectRoot, absoluteSourcePath)),
      outputPath: toPosixPath(relative(projectRoot, absoluteOutputPath)),
      absoluteSourcePath,
      absoluteOutputPath
    });
  }

  return assets;
}

async function validateBuildInputs(
  assets: readonly PlannedBuildAsset[],
  roots: { readonly outputDir: string; readonly projectRoot: string }
): Promise<readonly Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  for (const asset of assets) {
    // 多層防御: schema が files.* の ".." と絶対パスを、role を安全な segment に拒否していても、
    // buildProject は手組みの ResolvedProject も受け取る public API。files.* は project root 相対でも
    // part 相対でも解決されうる(resolvePartFilePath)ので、境界は **project root** で見る。出力は
    // outputDir 配下に留めなければならない。
    if (!isPathWithin(roots.projectRoot, asset.absoluteSourcePath)) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "BUILD_INPUT_ESCAPES_PROJECT",
          message:
            "ビルド出力が参照する part ファイルが project root の外にあります。 / A part file referenced for build output is outside the project root.",
          target: asset.sourcePath,
          suggestion: ["Use a files path inside the project without \"..\" or an absolute path."]
        })
      );
      continue;
    }

    if (!isPathWithin(roots.outputDir, asset.absoluteOutputPath)) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "BUILD_OUTPUT_PATH_ESCAPES_ROOT",
          message:
            "ビルド出力のパスが output ディレクトリの外を指しています。 / A build output path is outside the output directory.",
          target: asset.outputPath,
          suggestion: ["Use a project role without path separators or \"..\"."]
        })
      );
      continue;
    }

    // access() の失敗を「無い」に潰さない。権限エラー(EACCES 等)は BUILD_INPUT_FILE_MISSING と別の
    // errno 分類つき diagnostic にして、「権限で読めない」を「ファイルが無い」と誤診しない(R3)。
    const existence = await checkPathExistence(asset.absoluteSourcePath);

    if (existence.kind === "inaccessible") {
      diagnostics.push(
        describeFsError(existence.error, {
          code: "BUILD_INPUT_UNREADABLE",
          message:
            "ビルド対象の part ファイルにアクセスできませんでした。 / A part file referenced for build output could not be accessed.",
          target: asset.sourcePath,
          suggestion: ["Check the file path and filesystem permissions."]
        })
      );
      continue;
    }

    if (existence.kind === "missing") {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "BUILD_INPUT_FILE_MISSING",
          message:
            "ビルド出力が参照する part ファイルが存在しません。 / A part file referenced for build output does not exist.",
          target: asset.sourcePath,
          suggestion: [`Add the ${asset.kind} file, or update part files.${asset.kind}.`]
        })
      );
    }
  }

  return diagnostics;
}
