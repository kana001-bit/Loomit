import { listValDetailsFromText } from "./listValDetails.js";
import { loadPartFile } from "./loadPartFile.js";
import { projectDartsFromValText } from "./projectDartsFromVal.js";
import { projectNotchesFromValText } from "./projectNotchesFromVal.js";
import { readValSource } from "./readValSource.js";
import { collectPieceNames, normalizePieceKey } from "./valPieceScope.js";
import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { findProjectRoot } from "../project/findProjectRoot.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { Part } from "../schema/part.schema.js";

// 射影に使った source.val の状態。呼び手が製図構造の差分(diffValSources)を取るために返す ── 射影に出ない
// フィーチャ(製図式)が動いたかは Part からは分からないので、本文そのものを渡すしかない。
//
// 設計判断: **「無い」と「読めない」を潰さない。** 本文が undefined なだけだと、正常系(files.source 未宣言・
// .val がまだ無い)と異常系(権限等で読めない)が同じ形になる。`loom diff` は片側にだけ .val がある状態を
// 「製図ソースを付けた/外した」= changed と読むので、両者を潰すと**読めなかっただけの側を「変わった」と誤報**する
// (警告と同時に "moved" が出る)。呼び手が区別できる形で返す。
export type ProjectedPartSource =
  | { readonly status: "read"; readonly text: string }
  | { readonly status: "absent" }
  | { readonly status: "unreadable" };

export interface ProjectedPartLoad {
  readonly part: Part;
  // 本文を要求した呼び手(loadProjectedPartWithSource)にだけ付く。
  readonly source?: ProjectedPartSource;
}

// diff など編集フィーチャを消費する経路向けの loader。part.loom を純粋に読んだうえで、part.loom が
// 未記載のフィーチャ(darts / notches)だけを source.val から read-only に射影する。inline で書いてあれば
// 射影しない(案A: 消費経路でも不要な .val I/O を負わない)。darts / notches は同じ source.val を消費するため
// ファイルは1回だけ読み、各フィーチャへ射影する。射影で出た診断(読めない・未対応形状)は成功系でも捨てず、
// 呼び手がレポートに載せられるよう返す。check/build/fit はこの射影を必要としないため、素の loadPartFile を
// 使い .val I/O を負わない。
export async function loadProjectedPart(
  filePath: string,
  // project を既に読んでいる呼び手は projectRoot を渡す。省略時はこの関数が part.loom から登って探す。
  options?: { readonly projectRoot?: string }
): Promise<LoadFileResult<Part>> {
  const result = await loadProjected(filePath, {
    ...(options?.projectRoot === undefined ? {} : { projectRoot: options.projectRoot }),
    includeSource: false
  });

  if (!result.ok) {
    return result;
  }

  return { ok: true, value: result.value.part, diagnostics: result.diagnostics };
}

// loadProjectedPart に加えて source.val の**本文**も返す版。射影が不要(darts/notches とも inline)でも
// .val を読む点だけが違う ── 本文が要る呼び手にとっては、読まないことが目的の達成を妨げるため。
// 現在の呼び手は `loom diff`(製図構造が動いたかを言うために両版の本文を比べる)。
export async function loadProjectedPartWithSource(
  filePath: string,
  options?: { readonly projectRoot?: string }
): Promise<LoadFileResult<ProjectedPartLoad>> {
  return loadProjected(filePath, {
    ...(options?.projectRoot === undefined ? {} : { projectRoot: options.projectRoot }),
    includeSource: true
  });
}

async function loadProjected(
  filePath: string,
  options: { readonly projectRoot?: string; readonly includeSource: boolean }
): Promise<LoadFileResult<ProjectedPartLoad>> {
  const loadResult = await loadPartFile(filePath);

  if (!loadResult.ok) {
    return loadResult;
  }

  const part = loadResult.value;
  const sourceRelative = part.files?.source;
  // darts / notches が両方 inline なら射影は要らない。ただし本文を求められていれば読む必要がある。
  const projectionNeeded = part.darts === undefined || part.notches === undefined;

  // 射影元(source)が無い、または射影も本文も要らないなら source.val I/O を負わずにそのまま返す。
  // files.source が宣言されていない = 射影元が「無い」ので、本文を求められていれば absent と答える
  // (読めなかったのではない)。
  if (sourceRelative === undefined || (!projectionNeeded && !options.includeSource)) {
    return {
      ok: true,
      value: {
        part,
        ...(options.includeSource && sourceRelative === undefined
          ? { source: { status: "absent" as const } }
          : {})
      },
      diagnostics: loadResult.diagnostics
    };
  }

  // source の解決は project root 相対を優先する(resolvePartFilePath)。root が分からないと part 内の
  // 古いコピーを読んでしまうため、呼び手が渡さない場合はここで part.loom から登って探す
  // (失敗の扱いは resolveProjectRoot のコメントを参照)。
  const rootLookup: ProjectRootLookup =
    options.projectRoot === undefined
      ? await resolveProjectRoot(filePath)
      : { projectRoot: options.projectRoot, diagnostics: [] };

  // darts / notches は同じ source.val を消費するので、ファイルは1回だけ読んで各フィーチャへ射影する。
  const {
    sourceFilePath,
    source,
    status: readStatus,
    diagnostics: readDiagnostics
  } = await readValSource(filePath, sourceRelative, rootLookup.projectRoot);
  const diagnostics: Diagnostic[] = [
    ...loadResult.diagnostics,
    ...rootLookup.diagnostics,
    ...readDiagnostics
  ];
  let value: Part = part;

  if (source !== undefined) {
    // 1つの .val は1着ぶん(1 draw ＋ N detail)なので、射影は放っておくと着丸ごとのフィーチャを返す。この part が
    // どの detail かを決めるのは files.piece(= DXF export の BLOCK 名)で、それを射影器へ渡して自分のピース分だけに
    // 絞る。渡さないと front の合印変更が back の diff に出る(帰属の規則は valPieceScope)。
    const piece = part.files?.piece;

    // 2つの数え方を使い分ける。**混ざる相手がいるか**は detail の総数(無名も含む) ── 絞らない射影はダーツを
    // `<iPaths>` の帰属によらず全部返すので、無名 detail のダーツも混ざりうる。**帰属の identity** は名前のある
    // piece だけ(`collectPieceNames`) ── listValDetails のラベルは無名 detail に `detail#<id>` を割り当てるため、
    // それで一致を見ると存在しない piece を「ある」と誤判定する。
    const detailCount = listValDetailsFromText(source).totalDetails;
    const pieceNames = collectPieceNames(source);

    // `<detail>` が1つも無い .val(= `<details>` を持たない Seamly2D 方言)では、帰属という概念自体が無い。
    // files.piece は DXF BLOCK 名として他コマンドにも使う正当な宣言なので、ここでは無視して絞らずに射影する。
    // 絞ってしまうと「seam path の合印(方言1・帰属を持たないので絞られない)は残るのに、ダーツだけ `<iPaths>` 不在で
    // 黙って消える」という半端な結果になり、しかも piece 不在の警告まで出る(射影は成功しているのに)。
    // 判定は detail の**有無**であって名前の有無ではない ── detail はあるが無名なら、ピースは存在するのに identity が
    // 無い状態なので、宣言した piece は一致しようがない(絞って空＋警告が正しい)。
    const scopedPiece = detailCount === 0 ? undefined : piece;
    const pieceScope = scopedPiece === undefined ? {} : { piece: scopedPiece };
    let projectedCount = 0;

    // inline に無いフィーチャだけを、同じ .val テキストから read-only に射影する。
    if (part.darts === undefined) {
      const projection = projectDartsFromValText(source, {
        filePath: sourceFilePath,
        ...pieceScope
      });
      diagnostics.push(...projection.diagnostics);
      projectedCount += Object.keys(projection.darts).length;

      if (Object.keys(projection.darts).length > 0) {
        value = { ...value, darts: projection.darts };
      }
    }

    if (part.notches === undefined) {
      const projection = projectNotchesFromValText(source, {
        filePath: sourceFilePath,
        ...pieceScope
      });
      diagnostics.push(...projection.diagnostics);
      projectedCount += Object.keys(projection.notches).length;

      if (Object.keys(projection.notches).length > 0) {
        value = { ...value, notches: projection.notches };
      }
    }

    // piece scope の診断は「射影が空で返ったこと」を説明するためのもの。射影を1件も要求していない part
    // (darts も notches も inline)には言うことが無い ── 本文だけ欲しくて .val を読んだ(includeSource)ときに
    // ここへ入ると、「ダーツ・合印を射影できませんでした」という**事実と違う**警告が新しく生え、
    // report の status まで same → warning に反転する。射影を試みたときだけ説明する。
    if (projectionNeeded && piece === undefined) {
      // files.piece が無いと絞る鍵が無い。射影を丸ごと捨てると「この part にフィーチャが無い」と嘘をつくことになる
      // ので、従来どおり全ピース分を返しつつ、他ピースのものが混ざりうることを warning で知らせる。
      // 黙る条件を2つ置く: 射影が空(混ざりようがない)と、detail が1枚以下の .val(混ざる相手がいない ── 単一ピースの
      // .val や、detail を持たない Seamly2D 方言の fixture を毎回警告しない)。
      if (projectedCount > 0 && detailCount > 1) {
        diagnostics.push(
          createDiagnostic({
            severity: "warning",
            code: "PART_SOURCE_VAL_PIECE_UNDECLARED",
            message:
              "files.piece が未宣言のため、source.val から射影したダーツ・合印を型紙ピース単位に絞れませんでした。他のピースのものが混ざっている可能性があります。 / files.piece is not declared, so darts and notches projected from source.val could not be scoped to one pattern piece; features from other pieces may be included.",
            target: filePath,
            suggestion: [
              "part.loom の files.piece に、この part が対応する .val の detail 名(= DXF export の BLOCK 名)を宣言してください。 / Declare the .val detail name (the DXF export block name) for this part in files.piece."
            ]
          })
        );
      }
    } else if (projectionNeeded && piece !== undefined && detailCount > 0 && !hasPieceNamed(pieceNames, piece)) {
      // 宣言した piece が .val に無い(綴り違い・Valentina 側で detail をリネーム・.val の差し替え)。絞り込みは
      // 一致0件＝空を返すが、これは「このピースにはダーツも合印も無い」と見分けが付かない。黙ると diff から
      // フィーチャが丸ごと消えたまま正常に見えるので、explainable な warning を出す(collectEdgeOccurrencesFromVal
      // が同じ状況に出すのと同じ code)。推測で全ピースへ広げるフォールバックはしない ── 混ざった差分を正しい
      // 差分として見せることになり、このブランチが潰したバグに戻る。
      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: "PART_SOURCE_VAL_PIECE_NOT_FOUND",
          message:
            "files.piece に宣言した piece(detail)が source.val に見つからないため、ダーツ・合印を射影できませんでした。 / Could not find the piece (detail) declared in files.piece inside source.val, so no darts or notches were projected.",
          // target は piece 名。この code の既存の出どころ(collectEdgeOccurrencesFromVal)と同じ形式に揃える ──
          // 同じ code で target の形が2つあると、code をキーに target を読む消費側が壊れる。
          target: piece,
          suggestion: [
            "files.piece が .val の detail 名(= DXF BLOCK 名)と一致しているか確認してください。 / Check that files.piece matches a detail name (the DXF block name) in the .val."
          ]
        })
      );
    }
  }

  return {
    ok: true,
    value: {
      part: value,
      // 本文を求められていないときは載せない(呼び手が「読めなかった」と「要求しなかった」を取り違えない)。
      ...(options.includeSource
        ? {
            source:
              source === undefined
                ? { status: readStatus === "unreadable" ? ("unreadable" as const) : ("absent" as const) }
                : { status: "read" as const, text: source }
          }
        : {})
    },
    diagnostics
  };
}

// .val にその名前の piece(型紙ピース)があるか。比較は piece 名の共有規則(Seamlint の BLOCK 照合に合わせた
// 大小無視)に揃える ── 射影器の絞り込みと違う規則で見ると、射影は成功しているのに「見つからない」と警告する
// (あるいはその逆の)食い違いが起きる。
function hasPieceNamed(pieceNames: readonly string[], piece: string): boolean {
  const pieceKey = normalizePieceKey(piece);

  return pieceNames.some((pieceName) => normalizePieceKey(pieceName) === pieceKey);
}

interface ProjectRootLookup {
  readonly projectRoot?: string;
  readonly diagnostics: readonly Diagnostic[];
}

// part.loom から loomit.yml を探して project root を返す。2種類の失敗を区別する:
//
// - 見つからない(PROJECT_ROOT_NOT_FOUND): 正常系。orphan な part.loom を2つ直接比べる
//   `loom diff <a.loom> <b.loom>` が正当な使い方なので、診断を出さず part 相対にフォールバックする。
// - 読めない(権限エラー等): 握りつぶさない(R3)。undefined に畳むと「project の外」と区別が付かなくなり、
//   part 内の古いコピーから黙って射影したうえで正しい差分として報告してしまう ── このブランチが
//   潰そうとしている失敗そのものを、エラー経路から再導入することになる。errno 分類済みの診断を
//   warning に降格して surface し、射影自体は part 相対で続行する。
async function resolveProjectRoot(partFilePath: string): Promise<ProjectRootLookup> {
  const found = await findProjectRoot(partFilePath);

  if (found.ok) {
    return { projectRoot: found.value, diagnostics: [] };
  }

  return {
    diagnostics: found.diagnostics
      .filter((diagnostic) => diagnostic.code !== "PROJECT_ROOT_NOT_FOUND")
      .map((diagnostic) => ({ ...diagnostic, severity: "warning" as const }))
  };
}
