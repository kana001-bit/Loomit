import { access, cp, mkdir, rm, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { stringify } from "yaml";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { describeFsError } from "../filesystem/fsError.js";
import { isPathWithin, isSafePathSegment } from "../filesystem/pathWithin.js";
import { writeFileAtomic } from "../filesystem/writeFileAtomic.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";
import { loadPartFile } from "../parts/loadPartFile.js";
import { findProjectRoot } from "../project/findProjectRoot.js";
import type { Part } from "../schema/part.schema.js";
import type { LibraryMeta } from "../schema/library-meta.schema.js";

export interface PublishPartOptions {
  readonly partPath: string;
  readonly libraryRoot: string;
  readonly name?: string;
  readonly publishedAt?: string;
}

export interface PublishedPart {
  readonly part: Part;
  readonly meta: LibraryMeta;
  readonly sourcePartDirectory: string;
  readonly targetPartDirectory: string;
  readonly partFilePath: string;
  readonly metaFilePath: string;
}

interface ResolvedPartSource {
  readonly partFilePath: string;
  readonly partDirectory: string;
}

export async function publishPart(
  options: PublishPartOptions
): Promise<LoadFileResult<PublishedPart>> {
  const sourceResult = await resolvePartSource(options.partPath);

  if (!sourceResult.ok) {
    return sourceResult;
  }

  const partResult = await loadPartFile(sourceResult.value.partFilePath);

  if (!partResult.ok) {
    return partResult;
  }

  const part = partResult.value;
  const publishName = options.name ?? part.name;
  const libraryRoot = resolve(options.libraryRoot);
  const targetPartDirectory = resolve(
    libraryRoot,
    getLibraryTypeDirectory(part.type),
    publishName
  );
  const metaFilePath = join(targetPartDirectory, "meta.yml");

  // publish 名はディレクトリ segment 兼 library エントリ名になる。part.name は空でない文字列という
  // だけなので、"nested/name" や "../evil" が library root を抜け出したり読めないエントリを作ったり
  // しないよう、安全な単一 segment を要求する。
  if (!isSafePathSegment(publishName)) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "LIBRARY_PART_NAME_ESCAPES_ROOT",
          message: "The publish name must be a single path segment.",
          target: publishName,
          suggestion: ["Use a plain name without path separators, \"..\", or an absolute path."]
        })
      ]
    };
  }

  if (isPathWithin(sourceResult.value.partDirectory, targetPartDirectory)) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "LIBRARY_TARGET_INSIDE_PART",
          message: "Library target cannot be inside the source part directory.",
          target: targetPartDirectory,
          suggestion: ["Choose a library directory outside the part source directory."]
        })
      ]
    };
  }

  if (await pathExists(targetPartDirectory)) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "LIBRARY_PART_ALREADY_EXISTS",
          message: "A library part with this name already exists.",
          target: targetPartDirectory,
          suggestion: ["Choose another publish name, or remove the existing library entry."]
        })
      ]
    };
  }

  const meta = await createLibraryMeta({
    name: publishName,
    part,
    partDirectory: sourceResult.value.partDirectory,
    ...(options.publishedAt === undefined ? {} : { publishedAt: options.publishedAt })
  });

  try {
    await mkdir(dirname(targetPartDirectory), { recursive: true });
    await cp(sourceResult.value.partDirectory, targetPartDirectory, {
      recursive: true,
      force: false,
      errorOnExist: true
    });
    await writeFileAtomic(metaFilePath, stringify(meta));
  } catch (error) {
    // コピー済みの part を巻き戻し、meta 書き込み失敗で meta.yml の無い library エントリを残さない。
    // target はこの呼び出しの前には存在しなかった(上でガード済み)。
    await rm(targetPartDirectory, { recursive: true, force: true }).catch(() => undefined);

    return {
      ok: false,
      diagnostics: [
        describeFsError(error, {
          code: "LIBRARY_PUBLISH_FAILED",
          message: "Could not publish the part to the library.",
          target: targetPartDirectory,
          suggestion: ["Check the source path, library path, and filesystem permissions."]
        })
      ]
    };
  }

  return {
    ok: true,
    value: {
      part,
      meta,
      sourcePartDirectory: sourceResult.value.partDirectory,
      targetPartDirectory,
      partFilePath: join(targetPartDirectory, basename(sourceResult.value.partFilePath)),
      metaFilePath
    },
    diagnostics: []
  };
}

async function resolvePartSource(partPath: string): Promise<LoadFileResult<ResolvedPartSource>> {
  const resolvedPath = resolve(partPath);

  try {
    const stats = await stat(resolvedPath);

    if (stats.isDirectory()) {
      return {
        ok: true,
        value: {
          partFilePath: join(resolvedPath, "part.loom"),
          partDirectory: resolvedPath
        },
        diagnostics: []
      };
    }

    return {
      ok: true,
      value: {
        partFilePath: resolvedPath,
        partDirectory: dirname(resolvedPath)
      },
      diagnostics: []
    };
  } catch {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "PART_PUBLISH_SOURCE_NOT_FOUND",
          message: "Could not find the part path to publish.",
          target: resolvedPath,
          suggestion: ["Pass a part directory, or a part.loom file path."]
        })
      ]
    };
  }
}

async function createLibraryMeta(input: {
  readonly name: string;
  readonly part: Part;
  readonly partDirectory: string;
  readonly publishedAt?: string;
}): Promise<LibraryMeta> {
  const projectRootResult = await findProjectRoot(input.partDirectory);
  const sourceProject =
    projectRootResult.ok ? projectRootResult.value : undefined;
  const sourcePart =
    projectRootResult.ok ? relative(projectRootResult.value, input.partDirectory) : undefined;

  return {
    schema: "loomit.library_meta.v0",
    name: input.name,
    type: input.part.type,
    ...(sourceProject === undefined ? {} : { source_project: sourceProject }),
    ...(sourcePart === undefined ? {} : { source_part: sourcePart }),
    published_at: input.publishedAt ?? new Date().toISOString(),
    status: "published"
  };
}

function getLibraryTypeDirectory(type: string): string {
  if (type.endsWith("y")) {
    return `${type.slice(0, -1)}ies`;
  }

  return `${type}s`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
