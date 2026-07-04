import { parseYamlText } from "../filesystem/parseYamlText.js";
import { readText } from "../filesystem/readText.js";
import { partSchema } from "../schema/part.schema.js";
import { validateSchema } from "../schema/validateSchema.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";
import type { Part } from "../schema/part.schema.js";

// loadPartFile は part.loom を read -> parse -> validate するだけの純粋 loader。
// source.val からの darts 射影は check/build/fit には不要なので、この正本 load 経路には .val I/O を
// 混ぜない。darts を消費する経路(diff 等)は loadProjectedPart を使う。
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
