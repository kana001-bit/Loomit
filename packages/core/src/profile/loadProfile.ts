import { parseYamlText } from "../filesystem/parseYamlText.js";
import { readText } from "../filesystem/readText.js";
import { profileSchema } from "../schema/profile.schema.js";
import { validateSchema } from "../schema/validateSchema.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";
import type { Profile } from "../schema/profile.schema.js";

export async function loadProfileFile(filePath: string): Promise<LoadFileResult<Profile>> {
  const readResult = await readText(filePath);

  if (!readResult.ok) {
    return readResult;
  }

  const parseResult = parseYamlText(readResult.value, {
    invalidCode: "PROFILE_YAML_INVALID",
    target: filePath
  });

  if (!parseResult.ok) {
    return parseResult;
  }

  return validateSchema(profileSchema, parseResult.value, {
    invalidCode: "PROFILE_SCHEMA_INVALID",
    invalidMessage: "Profile file does not match the schema.",
    target: filePath
  });
}
