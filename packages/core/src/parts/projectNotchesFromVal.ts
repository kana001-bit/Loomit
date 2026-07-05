import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { collectBlocks, collectFirstBlock, collectSelfClosingTags } from "./valXml.js";
import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { getErrno } from "../filesystem/fsError.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { Notch } from "../schema/part.schema.js";

export interface ValentinaNotchProjectionResult {
  readonly notches: Readonly<Record<string, Notch>>;
  readonly diagnostics: readonly Diagnostic[];
}

export async function projectNotchesFromValFile(
  filePath: string
): Promise<ValentinaNotchProjectionResult> {
  let source: string;

  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    // source.val が無いのは正常系(合印を .val に持たない・未コミット等)。射影する元が無いだけなので
    // silent に空で返す。存在するのに読めない(権限等)ときだけ警告する(darts 射影と同じ約束)。
    if (getErrno(error) === "ENOENT") {
      return {
        notches: {},
        diagnostics: []
      };
    }

    return {
      notches: {},
      diagnostics: [
        createDiagnostic({
          severity: "warning",
          code: "PART_SOURCE_VAL_READ_FAILED",
          message:
            "source.val から合印(notch)を読み取れませんでした。 / Could not read notches from source.val.",
          target: filePath,
          suggestion: ["source.val の読み取り権限を確認してください。 / Check read permissions for source.val."]
        })
      ]
    };
  }

  return projectNotchesFromValText(source, {
    filePath
  });
}

// 設計判断: notch(合印)は縫い線上の「合わせ目印」であって幾何の点そのものではない。
// Valentina の modeling では、縫い線を表す <path name="seam"> の <node> に passmark="1" が立つ。
// ここではその passmark node を identity(seam＋node)＋param(縫い線上の正規化位置)へ射影する。
// 位置は幾何計算せず、.val 側が持つ position 属性(0..1)をそのまま読む(read-only 射影)。
export function projectNotchesFromValText(
  source: string,
  options: {
    readonly filePath: string;
  }
): ValentinaNotchProjectionResult {
  const drawBlocks = collectBlocks(source, "draw");
  const notches: Record<string, Notch> = {};
  const diagnostics: Diagnostic[] = [];

  for (const drawBlock of drawBlocks) {
    const drawName = drawBlock.attrs.name ?? "draw";
    const modelingBlock = collectFirstBlock(drawBlock.content, "modeling");

    if (modelingBlock === undefined) {
      continue;
    }

    for (const pathTag of collectBlocks(modelingBlock.content, "path")) {
      if (pathTag.attrs.name !== "seam") {
        continue;
      }

      const seamName = pathTag.attrs.seam ?? pathTag.attrs.id ?? "seam";
      const seamRef = `val:seam#${drawName}/${seamName}`;

      collectSelfClosingTags(pathTag.content, "node").forEach((node, index) => {
        if (node.attrs.passmark !== "1") {
          return;
        }

        const position = parsePosition(node.attrs.position);

        // identity は idObject / id を優先。どちらも無いときは node の並び順(index)が前後の
        // node 追加・削除でずれてしまうため、位置が読めていれば縫い線上位置を安定キーに使う
        // (合印は「縫い線のここ」で識別できる)。
        const nodeKey =
          node.attrs.idObject ??
          node.attrs.id ??
          (position === undefined ? String(index) : `pos${position}`);

        if (position === undefined) {
          diagnostics.push(
            createDiagnostic({
              severity: "warning",
              code: "PART_SOURCE_VAL_NOTCH_UNSUPPORTED",
              message:
                "縫い線上の位置(0..1)を持たない passmark を見つけたため、合印射影をスキップしました。 / Found a passmark without a seam position (0..1) and skipped notch projection.",
              target: `${options.filePath}#${drawName}/${seamName}/${nodeKey}`,
              suggestion: [
                "passmark には position 属性で縫い線上の正規化位置(0..1)を与えてください。 / Give each passmark a normalized seam position (0..1) via the position attribute."
              ]
            })
          );
          return;
        }

        notches[`val:${drawName}:notch:${seamName}:${nodeKey}`] = {
          seam_ref: seamRef,
          position,
          // passmarkType が空文字だと schema(min 1)に反するので、中身があるときだけ type を載せる。
          ...(node.attrs.passmarkType ? { type: node.attrs.passmarkType } : {})
        };
      });
    }
  }

  return {
    notches,
    diagnostics
  };
}

// NOTE: loadProjectedPart は source.val を1回読みに集約したため、現状この関数の Loomit 内部消費者は無い。
// ただし「part の相対パスから notches だけを read-only に射影する」自己完結APIとして public に残す。
// Seamlint(merge 周りの seam/geometry を focused に検査する将来ツール)のように、単一フィーチャだけを
// .val から取り出したい消費者に向く粒度なので温存する。責務分担は docs/work/diffable-domain.md 参照。
export async function projectPartNotchesFromSource(
  partFilePath: string,
  sourceRelativePath: string
): Promise<ValentinaNotchProjectionResult> {
  const sourceFilePath = resolve(dirname(partFilePath), sourceRelativePath);
  return projectNotchesFromValFile(sourceFilePath);
}

// 縫い線上の正規化位置。0..1 の有限数だけ受け付け、範囲外や非数値は「未対応」として弾く。
function parsePosition(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }

  // Number("") / Number(空白のみ) は 0 に化けるため、空文字は「位置なし」として弾く
  // (縫い線始点 0 の合印と取り違えない)。
  if (raw.trim() === "") {
    return undefined;
  }

  const value = Number(raw);

  if (!Number.isFinite(value) || value < 0 || value > 1) {
    return undefined;
  }

  return value;
}
