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

// 設計判断: notch(合印)は縫い線上の「合わせ目印」であって幾何の点そのものではない。射影は2方言を扱う:
//
//   方言1 Seamly2D — <draw>/<modeling>/<path name="seam"> の <node passmark="1" position=...>。
//     縫い線上の正規化位置(position 0..1)を .val が持つので、identity(seam＋node)＋param(位置＋深さ/幅)へ射影。
//     位置は幾何計算せず属性をそのまま読む(read-only 射影)。
//
//   方言2 実 Valentina — <draw>/<details>/<detail name>/<nodes> の <node passmark="true" passmarkLine=... passmarkAngle=...>。
//     合印は縫い線ではなく detail(型紙ピース)に属し、position を持たない(位置は仕上がり線の弧長=幾何で、DXF
//     export→Seamlint が測って解決する。Loomit は幾何を計算しない=A案)。よって identity は piece(detail名=DXF
//     BLOCK名)＋種別(passmarkLine=V/T)＋detail内順序(order)で表し、position/seam_ref は持たない。「どの .val
//     passmark = どの DXF notch か」の突き合わせは piece＋種別＋順序で効く
//     (docs/work/tasks/feature-seamlint-dxf-passmark-projection-integration.md)。
//
// 2方言は格納場所が排他(実 Valentina の passmark は modeling の seam path に載らず、Seamly2D fixture は
// <details> の passmark="true" node を持たない)ため、両スキャナを流しても二重計上しない。
// 注: .val の寸法は pattern の <unit>(cm/mm/inch)依存。現状は既存の射影(darts 含む)と同様に単位変換せず、
//     数値をそのまま mm として読む。<unit>→mm 変換は follow-up とする。
export function projectNotchesFromValText(
  source: string,
  options: {
    readonly filePath: string;
  }
): ValentinaNotchProjectionResult {
  const notches: Record<string, Notch> = {};
  const diagnostics: Diagnostic[] = [];

  projectSeamPathNotches(source, options, notches, diagnostics);
  projectDetailNotches(source, notches);

  return {
    notches,
    diagnostics
  };
}

// 方言1: Seamly2D の <modeling>/<path name="seam"> 上の passmark="1" node を射影する。
function projectSeamPathNotches(
  source: string,
  options: { readonly filePath: string },
  notches: Record<string, Notch>,
  diagnostics: Diagnostic[]
): void {
  for (const drawBlock of collectBlocks(source, "draw")) {
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

        // Seamly2D は合印の寸法を node に数値で持つ(notchLength=縫い代方向の深さ, notchWidth=マーク幅)。
        // 正の有限数だけ param 化し、未設定・0・負・非数値は「寸法指定なし」として黙って省く(既定値運用が正常系)。
        const depthMm = parsePositiveDimension(node.attrs.notchLength);
        const widthMm = parsePositiveDimension(node.attrs.notchWidth);

        notches[`val:${drawName}:notch:${seamName}:${nodeKey}`] = {
          seam_ref: seamRef,
          position,
          // passmarkType が空文字だと schema(min 1)に反するので、中身があるときだけ type を載せる。
          ...(node.attrs.passmarkType ? { type: node.attrs.passmarkType } : {}),
          ...(depthMm === undefined ? {} : { depth_mm: depthMm }),
          ...(widthMm === undefined ? {} : { width_mm: widthMm })
        };
      });
    }
  }
}

// 方言2: 実 Valentina の <draw>/<details>/<detail name>/<nodes> 上の passmark="true" node を射影する。
// position を持たない identity-only の合印(piece＋種別＋向き＋順序)として lift する。位置(縫い線上の弧長)は
// 幾何であり DXF export→Seamlint が解決するため、ここでは発明しない(A案)。
// .val は複数の <draw> を持ちうるため、seam-path 走査(方言1)や listValDetails と同じく draw ごとに <details> を
// 辿る。最初の <details> だけを見ると 2つ目以降の draw の合印を丸ごと落とす。
function projectDetailNotches(source: string, notches: Record<string, Notch>): void {
  for (const drawBlock of collectBlocks(source, "draw")) {
    const detailsBlock = collectFirstBlock(drawBlock.content, "details");

    if (detailsBlock === undefined) {
      continue;
    }

    for (const detail of collectBlocks(detailsBlock.content, "detail")) {
      const pieceName = detail.attrs.name;

      // detail 名は piece の identity(=DXF BLOCK名)。無名 detail は突き合わせに使えないため対象外。
      if (pieceName === undefined || pieceName.trim() === "") {
        continue;
      }

      const nodesBlock = collectFirstBlock(detail.content, "nodes");

      if (nodesBlock === undefined) {
        continue;
      }

      // order は同一 piece 内の passmark 並び順(contour/node 順で 0 始まり)。DXF は layer4=V/layer80=T の POINT を
      // seam 順に持つので、同一 piece・同一種別の合印が複数あっても「piece＋種別＋この順序」で 1:1 対応づけられる。
      // passmark でない contour node は DXF に対応点が無いため数に含めない。
      let passmarkOrder = 0;

      collectSelfClosingTags(nodesBlock.content, "node").forEach((node, index) => {
        if (node.attrs.passmark !== "true") {
          return;
        }

        // identity は idObject(実 Valentina では点参照として常に付く)を安定キーに。無い場合のみ
        // detail 内の node 並び順を fallback キーにする。
        const nodeKey = node.attrs.idObject ?? `node${index}`;
        const order = passmarkOrder;
        passmarkOrder += 1;

        notches[`val:${pieceName}:notch:${nodeKey}`] = {
          piece: pieceName,
          order,
          // passmarkLine(vMark/tMark 等)= 合印の種別。空なら種別なしとして省く(schema min 1)。
          ...(node.attrs.passmarkLine ? { type: node.attrs.passmarkLine } : {}),
          // passmarkAngle(straightforward 等)= 合印の向きの決め方。空なら省く。
          ...(node.attrs.passmarkAngle ? { angle: node.attrs.passmarkAngle } : {})
        };
      });
    }
  }
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

// 合印の寸法(深さ notchLength / 幅 notchWidth)。正の有限数だけ受け付け、未設定・空文字・0・負・非数値は
// 「寸法指定なし」として省く(Seamly2D は既定値運用があり、寸法が書かれていないのは正常系)。
function parsePositiveDimension(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }

  const value = Number(raw);

  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value;
}
