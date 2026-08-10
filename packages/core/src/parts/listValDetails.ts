import { readFile } from "node:fs/promises";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { getErrno } from "../filesystem/fsError.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";
import { collectBlocks } from "./valXml.js";

export interface ValDrawDetails {
  readonly drawName: string;
  readonly details: readonly string[];
}

export interface ValDetailList {
  readonly draws: readonly ValDrawDetails[];
  readonly totalDetails: number;
}

// .val から検出した1ピース。どの <draw> の <detail> かを覚えておく。ピース名は part の files.piece に
// 入り、DXF export の BLOCK 名として Seamlint の突き合わせ住所にもなるので、draw 名とセットで持つ。
export interface DetectedPiece {
  readonly drawName: string;
  readonly pieceName: string;
}

// .val を read-only で読み、draw ごとの <detail> ピース名を列挙する。幾何には触れず(Loomit は幾何を
// 計算しない: A案)、純粋な XML の read で取れる「どんなピースが入っているか」だけを返す。loom add が
// 1着 = 1 .val = N ピースを N part に scaffold する土台(案B)であり、取り込み前の一覧提示にも使う。
export async function listValDetailsFromFile(
  filePath: string
): Promise<LoadFileResult<ValDetailList>> {
  let source: string;

  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    return {
      ok: false,
      diagnostics: [describeValDetailsReadError(error, filePath)]
    };
  }

  return {
    ok: true,
    value: listValDetailsFromText(source),
    diagnostics: []
  };
}

export function listValDetailsFromText(source: string): ValDetailList {
  const draws = collectBlocks(source, "draw").map((drawBlock) => {
    const details = collectBlocks(drawBlock.content, "detail").map((detailBlock, index) =>
      formatDetailLabel(detailBlock.attrs, index)
    );

    return {
      drawName: drawBlock.attrs.name ?? "draw",
      details
    };
  });

  return {
    draws,
    totalDetails: draws.reduce((count, draw) => count + draw.details.length, 0)
  };
}

// draw ごとの detail 一覧を、(draw 名, ピース名)の平らな列に均す。1着 = 1 .val = N ピースを N part に
// 割る側(案B)は draw の入れ子ではなくピースの列で回るので、その形に合わせる。draw の出現順・その中の
// detail の出現順を保つ(取り込み前に見せた一覧と、実際に処理する順が食い違わないように)。
export function flattenDetectedPieces(detailList: ValDetailList): readonly DetectedPiece[] {
  return detailList.draws.flatMap((draw) =>
    draw.details.map((pieceName) => ({ drawName: draw.drawName, pieceName }))
  );
}

// detail の表示ラベルを決める。name 属性があればそれを、無ければ id、どちらも無ければ出現順の連番で
// 「detail#N」を返す(名前の無いピースでも一覧で一意に指せるようにする)。
function formatDetailLabel(
  attrs: Readonly<Record<string, string>>,
  index: number
): string {
  const name = attrs.name?.trim();

  if (name !== undefined && name.length > 0) {
    return name;
  }

  const id = attrs.id?.trim();

  if (id !== undefined && id.length > 0) {
    return `detail#${id}`;
  }

  return `detail#${index + 1}`;
}

function describeValDetailsReadError(error: unknown, filePath: string): Diagnostic {
  const errno = getErrno(error);

  if (errno === "EACCES" || errno === "EPERM") {
    return createDiagnostic({
      severity: "error",
      code: "PART_SOURCE_VAL_READ_FAILED",
      message:
        "取り込み元 .val の detail 一覧を読めませんでした。 / Could not read the .val detail list.",
      target: filePath,
      suggestion: [
        "ファイルの読み取り権限を確認してください。 / Check read permissions for the .val file."
      ]
    });
  }

  if (errno === "ENOENT") {
    return createDiagnostic({
      severity: "error",
      code: "PART_SOURCE_VAL_READ_FAILED",
      message:
        "取り込み元 .val の detail 一覧を読めませんでした。 / Could not read the .val detail list.",
      target: filePath,
      suggestion: ["ファイルの場所を確認してください。 / Check that the .val path is correct."]
    });
  }

  return createDiagnostic({
    severity: "error",
    code: "PART_SOURCE_VAL_READ_FAILED",
    message:
      "取り込み元 .val の detail 一覧を読めませんでした。 / Could not read the .val detail list.",
    target: filePath,
    suggestion: [
      "ファイルの内容と読み取り権限を確認してください。 / Check the file contents and read permissions."
    ]
  });
}
