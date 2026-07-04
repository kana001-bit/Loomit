import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { getErrno } from "../filesystem/fsError.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { Dart } from "../schema/part.schema.js";

export interface ValentinaDartProjectionResult {
  readonly darts: Readonly<Record<string, Dart>>;
  readonly diagnostics: readonly Diagnostic[];
}

interface XmlTagMatch {
  readonly attrs: Readonly<Record<string, string>>;
  readonly content: string;
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

export function projectDartsFromValText(
  source: string,
  options: {
    readonly filePath: string;
  }
): ValentinaDartProjectionResult {
  const drawBlocks = collectBlocks(source, "draw");
  const darts: Record<string, Dart> = {};
  const diagnostics: Diagnostic[] = [];

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

export async function projectPartDartsFromSource(
  partFilePath: string,
  sourceRelativePath: string
): Promise<ValentinaDartProjectionResult> {
  const sourceFilePath = resolve(dirname(partFilePath), sourceRelativePath);
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

function collectFirstBlock(source: string, tagName: string): XmlTagMatch | undefined {
  return collectBlocks(source, tagName)[0];
}

function collectBlocks(source: string, tagName: string): readonly XmlTagMatch[] {
  const pattern = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, "g");
  const tags: XmlTagMatch[] = [];

  for (const match of source.matchAll(pattern)) {
    tags.push({
      attrs: parseAttributes(match[1] ?? ""),
      content: match[2] ?? ""
    });
  }

  return tags;
}

function collectSelfClosingTags(source: string, tagName: string): readonly XmlTagMatch[] {
  const pattern = new RegExp(`<${tagName}\\b([^>]*)\\/>`, "g");
  const tags: XmlTagMatch[] = [];

  for (const match of source.matchAll(pattern)) {
    tags.push({
      attrs: parseAttributes(match[1] ?? ""),
      content: ""
    });
  }

  return tags;
}

function parseAttributes(source: string): Readonly<Record<string, string>> {
  const attrs: Record<string, string> = {};
  const attrPattern = /([A-Za-z0-9_:-]+)\s*=\s*"([^"]*)"/g;

  for (const match of source.matchAll(attrPattern)) {
    const key = match[1];
    const value = match[2];

    if (key !== undefined && value !== undefined) {
      attrs[key] = value;
    }
  }

  return attrs;
}
