import { parseYamlText } from "../filesystem/parseYamlText.js";
import { readText } from "../filesystem/readText.js";
import { partSchema } from "../schema/part.schema.js";
import { validateSchema } from "../schema/validateSchema.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";
import type { Part } from "../schema/part.schema.js";

export async function loadPartFile(filePath: string): Promise<LoadFileResult<Part>> {
  const readResult = await readText(filePath);

  if (!readResult.ok) {
    return readResult;
  }

  const parseResult = parseYamlText(readResult.value, {
    invalidCode: "PART_YAML_INVALID",
    target: filePath
  });

  if (!parseResult.ok) {
    return parseResult;
  }

  return validateSchema(partSchema, parseResult.value, {
    invalidCode: "PART_SCHEMA_INVALID",
    invalidMessage:
      "パーツファイルの形式が schema と一致しません。 / The part file does not match the schema.",
    target: filePath
  });
}
