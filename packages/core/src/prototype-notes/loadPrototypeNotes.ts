import { parseYamlText } from "../filesystem/parseYamlText.js";
import { readText } from "../filesystem/readText.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";
import {
  prototypeNotesSchema,
  type PrototypeNotes
} from "../schema/prototype-notes.schema.js";
import { validateSchema } from "../schema/validateSchema.js";

export async function loadPrototypeNotesFile(
  filePath: string
): Promise<LoadFileResult<PrototypeNotes>> {
  const readResult = await readText(filePath);

  if (!readResult.ok) {
    return readResult;
  }

  const parseResult = parseYamlText(readResult.value, {
    invalidCode: "PROTOTYPE_NOTES_YAML_INVALID",
    target: filePath
  });

  if (!parseResult.ok) {
    return parseResult;
  }

  return validateSchema(prototypeNotesSchema, parseResult.value, {
    invalidCode: "PROTOTYPE_NOTES_SCHEMA_INVALID",
    invalidMessage:
      "試作メモファイルの形式が schema と一致しません。/ The prototype notes file does not match the schema.",
    target: filePath
  });
}
