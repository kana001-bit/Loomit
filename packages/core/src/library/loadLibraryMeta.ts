import { parseYamlText } from "../filesystem/parseYamlText.js";
import { readText } from "../filesystem/readText.js";
import { libraryMetaSchema } from "../schema/library-meta.schema.js";
import { validateSchema } from "../schema/validateSchema.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";
import type { LibraryMeta } from "../schema/library-meta.schema.js";

export async function loadLibraryMetaFile(filePath: string): Promise<LoadFileResult<LibraryMeta>> {
  const readResult = await readText(filePath);

  if (!readResult.ok) {
    return readResult;
  }

  const parseResult = parseYamlText(readResult.value, {
    invalidCode: "LIBRARY_META_YAML_INVALID",
    target: filePath
  });

  if (!parseResult.ok) {
    return parseResult;
  }

  return validateSchema(libraryMetaSchema, parseResult.value, {
    invalidCode: "LIBRARY_META_SCHEMA_INVALID",
    invalidMessage: "Library metadata file does not match the schema.",
    target: filePath
  });
}
