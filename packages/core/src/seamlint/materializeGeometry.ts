import { readFile } from "node:fs/promises";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { SeamlintGeometryCheckRequest } from "./createGeometryRequest.js";

export interface SeamlintMaterializeResult {
  readonly request: SeamlintGeometryCheckRequest;
  readonly diagnostics: readonly Diagnostic[];
}

// createSeamlintGeometryRequest が作る request は各 part の geometrySource に「絶対パス」を入れるだけで、
// 幾何の本文は持たない。Seamlint を subprocess で呼ぶ handoff では、相手に Loomit のファイルツリーを
// 読ませないため、ここで各ソースを読み込み part.geometryText に inline して self-contained にする。
// 同じソースを複数 part が指す場合も1度だけ読む。読めなかったソースは diagnostic を出し、その part は
// text 無しのまま残す(Seamlint 側が source 未ロードとして報告する)。
export async function materializeSeamlintGeometry(
  request: SeamlintGeometryCheckRequest
): Promise<SeamlintMaterializeResult> {
  const diagnostics: Diagnostic[] = [];
  const textBySource = new Map<string, string | null>();

  for (const part of request.parts) {
    if (textBySource.has(part.geometrySource)) {
      continue;
    }

    try {
      textBySource.set(part.geometrySource, await readFile(part.geometrySource, "utf8"));
    } catch (error) {
      textBySource.set(part.geometrySource, null);
      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: "SEAMLINT_GEOMETRY_SOURCE_UNREADABLE",
          // 詳細(errorMessage)は日英併記を閉じたあとに1回だけ置く。日本語側と英語側の両方に差し込むと、
          // errno のメッセージが長いときに同じ内容が2回並び、区切りの "/" が本文に埋もれて日英の切れ目が
          // 読めなくなる(seamlintCheck / match / truerPropose と同じ規律)。
          message:
            `パーツ "${part.partId}" の幾何ソース "${part.geometrySource}" を読めなかったため、Seamlint に渡す縫い目の幾何を埋め込めませんでした。 / Loomit could not read geometry source "${part.geometrySource}" for part "${part.partId}", so it could not inline the seam geometry for Seamlint. (${errorMessage(error)})`,
          target: part.geometrySource,
          suggestion: [
            `Check that "${part.geometrySource}" exists and is readable before running loom slnt check.`
          ]
        })
      );
    }
  }

  const parts = request.parts.map((part) => {
    const text = textBySource.get(part.geometrySource);
    return text === undefined || text === null ? part : { ...part, geometryText: text };
  });

  return {
    request: { ...request, parts },
    diagnostics
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
