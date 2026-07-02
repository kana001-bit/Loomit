import { parseYamlText } from "../filesystem/parseYamlText.js";
import { readText } from "../filesystem/readText.js";
import { projectSchema } from "../schema/project.schema.js";
import { validateSchema } from "../schema/validateSchema.js";
import type { Project } from "../schema/project.schema.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";

export async function loadProjectFile(filePath: string): Promise<LoadFileResult<Project>> {
  const readResult = await readText(filePath);

  if (!readResult.ok) {
    return readResult;
  }

  const parseResult = parseYamlText(readResult.value, {
    invalidCode: "PROJECT_YAML_INVALID",
    target: filePath
  });

  if (!parseResult.ok) {
    return parseResult;
  }

  return validateSchema(projectSchema, parseResult.value, {
    invalidCode: "PROJECT_SCHEMA_INVALID",
    invalidMessage:
      "プロジェクトファイルの形式が schema と一致しません。 / The project file does not match the schema.",
    target: filePath
  });
}
