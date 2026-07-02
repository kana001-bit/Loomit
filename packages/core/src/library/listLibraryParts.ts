import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { getStatusForDiagnostics } from "../diagnostics/report.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";
import type { LibraryMeta } from "../schema/library-meta.schema.js";
import { loadLibraryMetaFile } from "./loadLibraryMeta.js";

export interface LibraryPartEntry {
  readonly meta: LibraryMeta;
  readonly partDirectory: string;
  readonly metaFilePath: string;
}

export interface ListLibraryPartsOptions {
  readonly libraryRoot: string;
  readonly type?: string;
}

export async function listLibraryParts(
  options: ListLibraryPartsOptions
): Promise<LoadFileResult<readonly LibraryPartEntry[]>> {
  const libraryRoot = resolve(options.libraryRoot);
  const diagnostics: Diagnostic[] = [];
  const entries: LibraryPartEntry[] = [];

  let typeDirectories: readonly string[];

  try {
    typeDirectories =
      options.type === undefined
        ? await readDirectoryNames(libraryRoot)
        : [getLibraryTypeDirectory(options.type)];
  } catch {
    return {
      ok: true,
      value: [],
      diagnostics: []
    };
  }

  for (const typeDirectory of typeDirectories) {
    const typeDirectoryPath = join(libraryRoot, typeDirectory);
    let partDirectories: readonly string[];

    try {
      partDirectories = await readDirectoryNames(typeDirectoryPath);
    } catch {
      continue;
    }

    for (const partDirectoryName of partDirectories) {
      const partDirectory = join(typeDirectoryPath, partDirectoryName);
      const metaFilePath = join(partDirectory, "meta.yml");
      const metaResult = await loadLibraryMetaFile(metaFilePath);

      if (!metaResult.ok) {
        diagnostics.push(...metaResult.diagnostics);
        continue;
      }

      if (options.type === undefined || metaResult.value.type === options.type) {
        entries.push({
          meta: metaResult.value,
          partDirectory,
          metaFilePath
        });
      }
    }
  }

  if (getStatusForDiagnostics(diagnostics) === "error") {
    return {
      ok: false,
      diagnostics
    };
  }

  return {
    ok: true,
    value: entries,
    diagnostics
  };
}

async function readDirectoryNames(directoryPath: string): Promise<readonly string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function getLibraryTypeDirectory(type: string): string {
  if (type.endsWith("y")) {
    return `${type.slice(0, -1)}ies`;
  }

  return `${type}s`;
}
