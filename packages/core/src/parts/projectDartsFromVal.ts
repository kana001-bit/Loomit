import { readFile } from "node:fs/promises";

import { collectPieceInternalPathIds } from "./valPieceScope.js";
import { collectBlocks, collectFirstBlock, collectSelfClosingTags } from "./valXml.js";
import { resolvePartFilePath } from "./resolvePartFilePath.js";
import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { getErrno } from "../filesystem/fsError.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { Dart } from "../schema/part.schema.js";

export interface ValentinaDartProjectionResult {
  readonly darts: Readonly<Record<string, Dart>>;
  readonly diagnostics: readonly Diagnostic[];
}

interface ValPoint {
  readonly id: string;
  readonly name?: string;
  readonly length?: string;
}

export async function projectDartsFromValFile(filePath: string): Promise<ValentinaDartProjectionResult> {
  let source: string;

  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    // source.val が存在しないのは正常系(build 用の参照だけ、未コミット、そもそも darts 無し等)。
    // 射影できる元が無いだけなので silent に空で返す。存在するのに読めない(権限等)ときだけ警告する。
    if (getErrno(error) === "ENOENT") {
      return {
        darts: {},
        diagnostics: []
      };
    }

    return {
      darts: {},
      diagnostics: [
        createDiagnostic({
          severity: "warning",
          code: "PART_SOURCE_VAL_READ_FAILED",
          message:
            "source.val からダーツを読み取れませんでした。 / Could not read darts from source.val.",
          target: filePath,
          suggestion: ["source.val の読み取り権限を確認してください。 / Check read permissions for source.val."]
        })
      ]
    };
  }

  return projectDartsFromValText(source, {
    filePath
  });
}

// piece を渡すと、その型紙ピースが `<iPaths>` で名指ししているダーツだけを射影する(帰属の規則は valPieceScope)。
// 省略時は .val 全体のダーツを射影する ── ダーツは `<draw>/<modeling>` に置かれ、パス自体は自分がどのピースに
// 載るかを知らないため、piece を渡さない呼び手には「着丸ごと」が返る。part へ射影する経路(loadProjectedPart)は
// 必ず piece を渡すこと。渡さないと front のダーツが back の diff に出る。
export function projectDartsFromValText(
  source: string,
  options: {
    readonly filePath: string;
    readonly piece?: string;
  }
): ValentinaDartProjectionResult {
  const drawBlocks = collectBlocks(source, "draw");
  const darts: Record<string, Dart> = {};
  const diagnostics: Diagnostic[] = [];
  const ownedPathIds =
    options.piece === undefined ? undefined : collectPieceInternalPathIds(source, options.piece);

  for (const drawBlock of drawBlocks) {
    const drawName = drawBlock.attrs.name ?? "draw";
    const calculationBlock = collectFirstBlock(drawBlock.content, "calculation");
    const modelingBlock = collectFirstBlock(drawBlock.content, "modeling");

    if (calculationBlock === undefined || modelingBlock === undefined) {
      continue;
    }

    const calculationPoints = collectSelfClosingTags(calculationBlock.content, "point").reduce<
      Record<string, ValPoint>
    >((points, tag) => {
      const id = tag.attrs.id;

      if (id === undefined) {
        return points;
      }

      points[id] = {
        id,
        ...(tag.attrs.name === undefined ? {} : { name: tag.attrs.name }),
        ...(tag.attrs.length === undefined ? {} : { length: tag.attrs.length })
      };
      return points;
    }, {});

    const modelingPoints = collectSelfClosingTags(modelingBlock.content, "point").reduce<
      Record<string, string>
    >((points, tag) => {
      if (tag.attrs.type !== "modeling") {
        return points;
      }

      const modelingPointId = tag.attrs.id;
      const calculationPointId = tag.attrs.idObject;

      if (modelingPointId !== undefined && calculationPointId !== undefined) {
        points[modelingPointId] = calculationPointId;
      }

      return points;
    }, {});

    for (const pathTag of collectBlocks(modelingBlock.content, "path")) {
      if (pathTag.attrs.name !== "dart") {
        continue;
      }

      // piece 指定時は、その piece の `<iPaths>` に載っているダーツだけを残す。id の無いパスは名指しできない
      // ＝どのピースにも帰属できないので、推測せず落とす(id 無しは実 Valentina では起きない)。
      if (ownedPathIds !== undefined) {
        const pathId = pathTag.attrs.id;

        if (pathId === undefined || !ownedPathIds.has(pathId)) {
          continue;
        }
      }

      const nodePointIds = collectSelfClosingTags(pathTag.content, "node")
        .map((node) => node.attrs.idObject)
        .filter((id): id is string => id !== undefined);
      const calculationPath = nodePointIds
        .map((modelingPointId) => modelingPoints[modelingPointId])
        .filter((id): id is string => id !== undefined)
        .map((calculationPointId) => calculationPoints[calculationPointId])
        .filter((point): point is ValPoint => point !== undefined);

      const projectedDart = projectPathToDart(drawName, pathTag.attrs.id ?? "path", calculationPath);

      if (projectedDart === undefined) {
        diagnostics.push(
          createDiagnostic({
            severity: "warning",
            code: "PART_SOURCE_VAL_DART_UNSUPPORTED",
            message:
              "対応していない Valentina の dart path 形状を見つけたため、ダーツ射影をスキップしました。 / Found an unsupported Valentina dart path shape and skipped dart projection.",
            target: `${options.filePath}#${drawName}/${pathTag.attrs.id ?? "path"}`,
            suggestion: [
              "現状は 3 点 dart と、先頭終端が同一点の 5 点 dart を想定しています。 / The current projection expects 3-point darts or 5-point darts that repeat the first point at the end."
            ]
          })
        );
        continue;
      }

      darts[projectedDart.id] = projectedDart.dart;
    }
  }

  return {
    darts,
    diagnostics
  };
}

// NOTE: loadProjectedPart は source.val を1回読みに集約したため、現状この関数の Loomit 内部消費者は無い。
// ただし「part の相対パスから darts だけを read-only に射影する」自己完結APIとして public に残す。
// 注: この経路は piece で絞らない(.val 全体のダーツを返す)。part 単位へ射影する呼び手は projectDartsFromValText に
// piece を渡すこと。
// Seamlint(merge 周りの seam/geometry を focused に検査する将来ツール)のように、単一フィーチャだけを
// .val から取り出したい消費者に向く粒度なので温存する。責務分担は docs/work/diffable-domain.md 参照。
export async function projectPartDartsFromSource(
  partFilePath: string,
  sourceRelativePath: string,
  // project root が分かる呼び手は渡す。渡すと root の原本を優先する(resolvePartFilePath の優先順位)。
  projectRoot?: string
): Promise<ValentinaDartProjectionResult> {
  const sourceFilePath = resolvePartFilePath({
    partFilePath,
    value: sourceRelativePath,
    ...(projectRoot === undefined ? {} : { projectRoot })
  });
  return projectDartsFromValFile(sourceFilePath);
}

function projectPathToDart(
  drawName: string,
  pathId: string,
  points: readonly ValPoint[]
): { readonly id: string; readonly dart: Dart } | undefined {
  const shape = classifyDartPath(points);

  if (shape === undefined) {
    return undefined;
  }

  const leftLeg = points[shape.leftLegIndex];
  const apex = points[shape.apexIndex];
  const rightLeg = points[shape.rightLegIndex];

  if (leftLeg === undefined || apex === undefined || rightLeg === undefined) {
    return undefined;
  }

  const widthFormula = inferWidthFormula(leftLeg, rightLeg);
  const dart: Dart = {
    apex_ref: formatPointRef(drawName, apex),
    ...(widthFormula === undefined ? {} : { width_formula: widthFormula }),
    ...(apex.length === undefined ? {} : { intake_length_formula: apex.length }),
    legs: {
      left_ref: formatPointRef(drawName, leftLeg),
      right_ref: formatPointRef(drawName, rightLeg)
    }
  };

  return {
    id: `val:${drawName}:dart:${pathId}`,
    dart
  };
}

function classifyDartPath(
  points: readonly ValPoint[]
):
  | {
      readonly leftLegIndex: number;
      readonly apexIndex: number;
      readonly rightLegIndex: number;
    }
  | undefined {
  if (points.length === 3) {
    return {
      leftLegIndex: 0,
      apexIndex: 1,
      rightLegIndex: 2
    };
  }

  if (points.length === 5 && points[0]?.id === points[4]?.id) {
    return {
      leftLegIndex: 1,
      apexIndex: 2,
      rightLegIndex: 3
    };
  }

  return undefined;
}

function inferWidthFormula(...points: readonly ValPoint[]): string | undefined {
  for (const point of points) {
    const base = point.length === undefined ? undefined : extractHalfBase(point.length);

    if (base !== undefined) {
      return base;
    }
  }

  return undefined;
}

// leg length は全幅の半分。`x / 2` と `x * 0.5` / `0.5 * x` から全幅の式(x)を復元する。
// 0.5 は `.5` や `0.50` も許容し、`0.05` のような別の係数は弾く。
function extractHalfBase(formula: string): string | undefined {
  const divideMatch = formula.match(/^\s*(.+?)\s*\/\s*2\s*$/);

  if (divideMatch?.[1] !== undefined) {
    return divideMatch[1].trim();
  }

  const multiplyRightMatch = formula.match(/^\s*(.+?)\s*\*\s*0?\.50*\s*$/);

  if (multiplyRightMatch?.[1] !== undefined) {
    return multiplyRightMatch[1].trim();
  }

  const multiplyLeftMatch = formula.match(/^\s*0?\.50*\s*\*\s*(.+?)\s*$/);

  if (multiplyLeftMatch?.[1] !== undefined) {
    return multiplyLeftMatch[1].trim();
  }

  return undefined;
}

function formatPointRef(drawName: string, point: ValPoint): string {
  return `val:point#${drawName}/${point.name ?? point.id}`;
}
