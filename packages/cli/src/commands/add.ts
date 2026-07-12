import { access } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

import {
  addPartToProject,
  checkValSourceExists,
  isSafePathSegment,
  listValDetailsFromFile,
  loadProject,
  resolveParts
} from "@loomit/core";
import type { AddedPart, AddPartConnectorInput } from "@loomit/core";
import { formatDiagnosticsText } from "../formatters/diagnosticsText.js";
import { createReadlinePrompter, EndOfInputError } from "../prompter.js";
import type { Prompter } from "../prompter.js";

export interface AddCommandOptions {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  // テストは scripted Prompter を注入する。未指定なら readline で対話する。
  readonly prompter?: Prompter;
}

interface ParsedAddArgs {
  readonly help: boolean;
  // --yes: 対話をせず、検出した全ピースをデフォルトで一括生成する(連結なし)。
  readonly yes: boolean;
  readonly valPath?: string;
}

interface PartAnswers {
  readonly name: string;
  readonly type: string;
  readonly variant: string;
  readonly connectors: readonly AddPartConnectorInput[];
}

// detail(ピース)ごとの回答。role(front / back)を type(body / sleeve)とは別軸で持つ(案B)。
interface DetailPartAnswers extends PartAnswers {
  readonly role: string;
}

// .val から検出した1ピース。どの <draw> の <detail> かを覚えておき、prompt 見出しと files.piece に使う。
interface DetectedPiece {
  readonly drawName: string;
  readonly pieceName: string;
}

// type は garment 上の役割。schema は自由な単一 segment だが、よく使う候補を出して選びやすくする。
const TYPE_CHOICES = ["body", "sleeve", "collar", "cuff", "facing", "other"] as const;
// connector は「名前付きの join(縫い合わせ先)」で、check は両パーツが同じ id を宣言しているかだけで
// ペアにする(seam の形の分類ではなく id の一致が本質)。そこで形の taxonomy から選ばせるのをやめ、
// 「プロジェクト内に既にある join から選ぶ」か「新しい join を名付ける」かで縫い合わせ相手を決めさせる。
// 既存から選べば相手と id が確実に一致し(打ち間違いで繋がらない事故を防ぐ)、新規なら将来のパーツが
// 選べる join になる。将来は .val の <path name="seam" seam="..."> から join を供給する余地も残す。

// 「新しい join を名付ける」を表す select の番兵。この文字列は isSafePathSegment を通ってしまう
// (slash も ".." も含まない)ため、実 join id としては promptNewJoinId で拒否する。許してしまうと、
// 次回以降その join を選んでも番兵と誤認され、同名 join を再利用できなくなる。
const NAME_NEW_JOIN = "(name a new join)";

// seam の種類(connector.type)。id とは別軸のラベルで、ペアリングには使われない(check は id で繋ぐ)。
// よく使う縫い目種を候補に出して選びやすくする(glossary の Connector 例に対応)。schema 上 type は
// パス segment ではなく自由文字列なので、"other" では単語以外(空白入り等)も受け付ける。
const SEAM_TYPE_CHOICES = [
  "side",
  "shoulder",
  "armhole",
  "neckline",
  "waist",
  "hem",
  "other"
] as const;

// プロジェクト内に既にある join(縫い合わせ先候補)。id・その種類(type)・宣言しているパーツ(role)を持つ。
// id は縫い目ごとに一意な rendezvous、type は種類ラベル。既存 join に繋ぐときは相手の id と type を継ぐ
// (同じ縫い目なので種類も同じ。第2の当事者に type を訊き直すと同一 seam で分類が食い違いうる)。
interface ExistingJoin {
  readonly id: string;
  readonly type: string;
  readonly roles: readonly string[];
}

// 対話で決まった1つの縫い合わせ先。一意な id と種類 type を分けて持つ(buildConnectors がこの2軸を書く)。
interface ChosenJoin {
  readonly id: string;
  readonly type: string;
}

export async function runAddCommand(
  args: readonly string[],
  options: AddCommandOptions
): Promise<number> {
  const parsedArgs = parseAddArgs(args);

  if (typeof parsedArgs === "string") {
    options.stderr(`${parsedArgs}\n\n${formatAddHelp()}`);
    return 2;
  }

  if (parsedArgs.help || parsedArgs.valPath === undefined) {
    options.stdout(formatAddHelp());
    return parsedArgs.help ? 0 : 2;
  }

  const valPath = resolve(options.cwd, parsedArgs.valPath);
  const defaultName = stripExtension(basename(parsedArgs.valPath));

  // 対話を始める前に .val の存在を確認する。無ければ即座に失敗させ、name/type/seam を全部入力させた
  // 最後に「見つからない」と言う無駄をなくす(core も書き込み直前に同じ関門を持つ)。
  const missingSource = await checkValSourceExists(valPath);

  if (missingSource !== undefined) {
    options.stderr(`${formatDiagnosticsText([missingSource]).join("\n")}\n`);
    return 1;
  }

  // .val を read-only で覗いて <detail> ピースを列挙する。1着 = 1 .val = N ピースなので、ここで割り出した
  // ピースの数だけ part を作る(案B)。読めなければ幾何に触れる前に explainable な診断で止める。
  const detailList = await listValDetailsFromFile(valPath);

  if (!detailList.ok) {
    options.stderr(`${formatDiagnosticsText(detailList.diagnostics).join("\n")}\n`);
    return 1;
  }

  // 検出した draw / detail を先に見せる(取り込み前の read-only な一覧)。何が入るか分かってから対話に入る。
  const detectedDetails = formatDetectedDetails(detailList.value);

  if (detectedDetails !== undefined) {
    options.stdout(detectedDetails);
  }

  const detectedPieces = flattenDetectedPieces(detailList.value);

  // draw はあるが detail が1つも無い .val(construction のみ、裁断ピース未定義)。黙って落とさず、
  // 「取り込むピースが無い」と案内して何も追加せずに正常終了する(実データに存在するケース)。
  if (detailList.value.draws.length > 0 && detectedPieces.length === 0) {
    options.stdout(
      "No detail pieces were added. Add <detail> pieces in Valentina, then run loom add again.\n"
    );
    return 0;
  }

  // --yes: 対話をせず、検出した全ピースをデフォルトで一括生成する。prompter を作る前に分岐して
  // stdin を開かない(パイプ / CI でも動く)。連結の候補集めも要らないので collectExistingJoins より前で返す。
  if (parsedArgs.yes) {
    return await addAllPiecesWithDefaults(options, valPath, detectedPieces, defaultName);
  }

  // 縫い合わせ相手の候補(join)は遅延ロードする。連結を1つも足さない add(「Add a seam connector?」に N)では
  // project を一切読まないよう、既存パーツが宣言済みの join(ベース)を初回に必要になったときだけ1回読んで
  // キャッシュする。取得できなくても add は続行する(最初のパーツや壊れた project では候補なしで新規命名に倒す)。
  // それに、この add で続けて足したピースの join を重ねて返す(直前のピースが宣言した join を選べる)。
  let baseJoins: readonly ExistingJoin[] | undefined;
  const addedJoins = new Map<string, { type: string; roles: string[] }>();

  const listJoins = async (): Promise<readonly ExistingJoin[]> => {
    if (baseJoins === undefined) {
      baseJoins = await collectExistingJoins(options.cwd);
    }

    return combineJoins(baseJoins, addedJoins);
  };

  // 足したばかりの part の connectors を候補に反映する(次のピースが同じ join(id と type)を選べるように)。
  // ベース未ロードでも記録だけしておき、次に候補が必要になったとき combineJoins でベースと合流する。
  const recordAddedJoins = (
    role: string,
    connectors: Readonly<Record<string, { readonly type: string }>> | undefined
  ): void => {
    for (const [joinId, connector] of Object.entries(connectors ?? {})) {
      const entry = addedJoins.get(joinId);

      if (entry === undefined) {
        addedJoins.set(joinId, { type: connector.type, roles: [role] });
      } else if (!entry.roles.includes(role)) {
        entry.roles.push(role);
      }
    }
  };

  const prompter = options.prompter ?? createReadlinePrompter();

  try {
    // detail を割り出せない .val(draw も detail も無い等)は、旧来の 1 .val=1 part 経路に倒す。
    if (detectedPieces.length === 0) {
      const answers = await collectAnswers(prompter, options.stdout, defaultName, listJoins);
      return await addOnePart(options, valPath, answers);
    }

    for (const [index, piece] of detectedPieces.entries()) {
      // 元 .val が parts/ 内なら「取り込み後に削除(= 実質 move)」だが、複数ピースでは後続が同じ元を要る。
      // 消費(削除)は最後のピースだけに任せ、途中で元を消して後続が PART_ADD_SOURCE_NOT_FOUND で落ちて
      // 部分取り込みになるのを防ぐ。途中で失敗しても元は残る(最後の成功まで消えない)。
      const isLastPiece = index === detectedPieces.length - 1;

      // 今どのピースを訊いているかを毎回見出しで示す(複数ピースを続けて訊くので迷子にしない)。
      options.stdout(formatPiecePromptHeader(piece));

      const answers = await collectDetailAnswers(
        prompter,
        options.stdout,
        piece.pieceName,
        listJoins
      );
      const result = await addPartToProject({
        projectPath: options.cwd,
        valPath,
        name: answers.name,
        role: answers.role,
        type: answers.type,
        variant: answers.variant,
        piece: piece.pieceName,
        keepSource: !isLastPiece,
        ...(answers.connectors.length === 0 ? {} : { connectors: answers.connectors })
      });

      if (!result.ok) {
        options.stderr(`${formatDiagnosticsText(result.diagnostics).join("\n")}\n`);
        return 1;
      }

      options.stdout(formatAddSuccess(result.value));
      // 足したばかりの part の connectors を候補に反映し、次のピースが同じ join(id と type)を選んで
      // 繋げられるようにする。
      recordAddedJoins(result.value.role, result.value.part.connectors);
    }

    return 0;
  } catch (error) {
    // パイプ/リダイレクト入力が必要な回答数に足りず、default で埋められない prompt(Custom type / New join 名 等)に
    // 達したとき。空回答で問い直し続けてハングするより、ここで綺麗に失敗終了させる。
    if (error instanceof EndOfInputError) {
      options.stderr(
        "Input ended before all required answers were provided.\n" +
          "Provide every answer, or run it in an interactive terminal.\n"
      );
      return 1;
    }

    throw error;
  } finally {
    prompter.close();
  }
}

export function formatAddHelp(): string {
  return (
    [
      "Usage: loom add <file.val> [--yes]",
      "",
      "Add a Valentina .val to the project. If Loomit detects <detail> pieces,",
      "it scaffolds one part per piece and records files.piece in each part. If",
      "the file has draws but no pieces yet, Loomit prints guidance and adds",
      "nothing. Otherwise it falls back to the legacy single-part prompt.",
      "",
      "Options:",
      "  --yes, -y  Scaffold every detected piece with defaults (role = piece name,",
      '             type "body", no connectors) without prompting. Fastest way to',
      "             turn a multi-piece .val into a checkable project. If a detail name",
      "             collides with a part role, it asks for a distinct role only in an",
      "             interactive terminal; in a non-interactive shell it fails cleanly",
      "             (writing nothing) instead of prompting.",
      "  --help     Show this help."
    ].join("\n") + "\n"
  );
}

// 検出した draw / detail を取り込み前に見せる read-only な一覧を組む。draw が無ければ何も出さない
// (undefined を返す)。detail 0 件の draw は「piece: none」と明示し、silent に見落とさせない。
function formatDetectedDetails(detailList: {
  readonly draws: readonly {
    readonly drawName: string;
    readonly details: readonly string[];
  }[];
  readonly totalDetails: number;
}): string | undefined {
  if (detailList.draws.length === 0) {
    return undefined;
  }

  const lines = ["Detected Valentina details:"];

  for (const draw of detailList.draws) {
    lines.push(`  draw: ${draw.drawName}`);

    if (draw.details.length === 0) {
      lines.push("  pieces: none");
      lines.push("  This .val has no <detail> pieces yet; Loomit can only show the draw for now.");
      continue;
    }

    lines.push(`  pieces (${draw.details.length}):`);

    for (const detail of draw.details) {
      lines.push(`    - ${detail}`);
    }
  }

  if (detailList.totalDetails > 0) {
    lines.push(`  total pieces: ${detailList.totalDetails}`);
  }

  return `${lines.join("\n")}\n\n`;
}

// detail を割り出せない .val 向けの旧来経路。role を分けず(type を role として使う)1 part だけ生成する。
async function addOnePart(
  options: AddCommandOptions,
  valPath: string,
  answers: PartAnswers
): Promise<number> {
  const result = await addPartToProject({
    projectPath: options.cwd,
    valPath,
    name: answers.name,
    type: answers.type,
    variant: answers.variant,
    ...(answers.connectors.length === 0 ? {} : { connectors: answers.connectors })
  });

  if (!result.ok) {
    options.stderr(`${formatDiagnosticsText(result.diagnostics).join("\n")}\n`);
    return 1;
  }

  options.stdout(formatAddSuccess(result.value));
  return 0;
}

// --yes: 対話せず、検出した全ピースをデフォルトで一括生成する。role=ピース名 / name=ピース名 /
// type="body" / variant="v1" / 連結なし。7ピースの add を質問ゼロにするための経路(まず check が通る
// 足場を最短で作るのが狙い)。連結や type の調整は生成後に part.loom を編集して行う。
async function addAllPiecesWithDefaults(
  options: AddCommandOptions,
  valPath: string,
  detectedPieces: readonly DetectedPiece[],
  defaultName: string
): Promise<number> {
  // detail を割り出せない .val は旧来の 1 part 経路にデフォルトで倒す。
  if (detectedPieces.length === 0) {
    return addOnePart(options, valPath, {
      name: defaultName,
      type: "body",
      variant: "v1",
      connectors: []
    });
  }

  // role はパス segment になるので、安全な名前のピースだけ自動追加する。安全でない名前は prompt できない
  // ので skip し、どれを手動で足すべきか明示する(--yes でも黙って取りこぼさない)。
  const addable = detectedPieces.filter((piece) => isSafePathSegment(piece.pieceName));
  // skip したピースがあるか。ある場合は元 .val を消費(削除)しない ── 案内どおり後から手動追加するには
  // 取り込み元が要るため。消してしまうと skip 分の .val 参照先が失われ「--yes なしで再実行」ができなくなる。
  const hasSkips = addable.length !== detectedPieces.length;

  for (const piece of detectedPieces) {
    if (!isSafePathSegment(piece.pieceName)) {
      options.stdout(
        `Skipped "${piece.pieceName}": name is not a safe role. Add it with loom add (no --yes) to name its role.\n`
      );
    }
  }

  if (addable.length === 0) {
    options.stderr(
      "No pieces could be added automatically. Run loom add without --yes to name roles by hand.\n"
    );
    return 1;
  }

  // role 衝突(同名 detail)は書き込み前に解決する。衝突しないピースは role=ピース名 で自動生成し、衝突した
  // ピースだけ distinct な role を対話で訊く(B)。判定は実 FS の case 感度に合わせ(正本 loomit.yml をプローブ)、
  // 既存 project の part role も衝突対象に含める。全 role を書き込み前に確定するので、入力途中で失敗しても
  // part を1つも書かない(部分適用しない)。
  const loaded = await loadProject(options.cwd);
  const caseInsensitive = loaded.ok
    ? await isCaseInsensitiveFsAt(loaded.value.paths.projectFilePath)
    : true; // 読めないなら add 自体が失敗する。判定材料が無いので安全側(衝突を拾う)に倒す。
  const normalizeRoleKey = (role: string): string => (caseInsensitive ? role.toLowerCase() : role);

  // 既に使われている role(既存 part)を seed。new piece がこれと衝突しても書き込み前に別 role を要求する。
  const takenRoleKeys = new Set<string>();
  if (loaded.ok) {
    for (const existingRole of Object.keys(loaded.value.project.parts)) {
      takenRoleKeys.add(normalizeRoleKey(existingRole));
    }
  }

  // 元からプロジェクトに登録済みの role のスナップショット。ループ中に takenRoleKeys へ積んでいく
  // 「この run で先に決めた role」と区別し、衝突の理由(= 同じ .val をもう一度 add したのか / .val 内に
  // 同名 detail があるのか)を言い分けるために使う。一番効く「もう入ってるよ」を伝えるのが狙い。
  const existingRoleKeys = new Set(takenRoleKeys);

  // role 衝突(既存 part / 先行ピース / detail 重複)するピースを書き込み前に洗い出す。
  const collidingPieceNames = collectCollidingPieceNames(addable, takenRoleKeys, normalizeRoleKey);

  // --yes は automation を止めない契約。衝突の解決には role 入力が要るが、非対話(TTY でない CI / パイプ)では
  // stdin を開かず、書き込みも一切せずに clean fail する。対話端末(または注入 prompter)のときだけ衝突分を訊く。
  const prompter =
    collidingPieceNames.length === 0
      ? undefined
      : (options.prompter ?? (process.stdin.isTTY === true ? createReadlinePrompter() : undefined));

  if (collidingPieceNames.length > 0 && prompter === undefined) {
    // 衝突のうち「元からプロジェクトにある role」= もう一度 add しているサイン。あれば真っ先に伝える。
    const alreadyInProject = collidingPieceNames.filter((name) =>
      existingRoleKeys.has(normalizeRoleKey(name))
    );
    const alreadyNote =
      alreadyInProject.length > 0
        ? ` These roles are already in this project (${alreadyInProject.join(", ")}), so this .val may have been added already.`
        : "";

    options.stderr(
      `Detail names collide as part roles (${collidingPieceNames.join(", ")}), and --yes does not prompt in a non-interactive shell.` +
        alreadyNote +
        " Run loom add in an interactive terminal to name the colliding roles, or give each piece a distinct detail name in Valentina.\n"
    );
    return 1;
  }

  // 自分で開いた readline だけ後で閉じる(注入された prompter は呼び手/テストの持ち物なので閉じない)。
  const ownPrompter = prompter !== undefined && prompter !== options.prompter;

  const resolvedRoles: { readonly piece: DetectedPiece; readonly role: string }[] = [];

  try {
    for (const piece of addable) {
      const key = normalizeRoleKey(piece.pieceName);

      if (!takenRoleKeys.has(key)) {
        takenRoleKeys.add(key);
        resolvedRoles.push({ piece, role: piece.pieceName });
        continue;
      }

      // 衝突。上のガードにより、衝突があるなら prompter は必ず存在する(この分岐は collidingPieceNames > 0 のときのみ到達)。
      if (prompter === undefined) {
        throw new Error("internal: expected a prompter to resolve a role collision");
      }

      // safe segment かつ未使用になるまで distinct な role を訊く。
      const role = await promptDistinctRole(
        prompter,
        options.stdout,
        piece.pieceName,
        takenRoleKeys,
        existingRoleKeys,
        normalizeRoleKey
      );
      takenRoleKeys.add(normalizeRoleKey(role));
      resolvedRoles.push({ piece, role });
    }
  } catch (error) {
    // 対話中に入力が尽きたとき。role は書き込み前に確定するので、まだ1件も書いておらず部分適用は無い。
    if (error instanceof EndOfInputError) {
      options.stderr(
        "Input ended before all colliding roles were provided.\n" +
          "Give each colliding piece a distinct role, or run it in an interactive terminal.\n"
      );
      return 1;
    }

    throw error;
  } finally {
    if (ownPrompter) {
      prompter?.close();
    }
  }

  // 完全同名(綴りまで同じ)の detail は files.piece が同一 = 同じピースを指す part になる。role は分けたが
  // 幾何ソースは同じ、という曖昧さを黙って通さないよう警告する。
  const repeatedNames = findCollidingRoleNames(
    addable.map((piece) => piece.pieceName),
    false
  );
  if (repeatedNames.length > 0) {
    options.stdout(
      `Note: detail names (${repeatedNames.join(", ")}) repeat in the .val, so those parts point at the same piece. ` +
        "Rename them in Valentina if they are meant to be different pieces.\n"
    );
  }

  for (const [index, { piece, role }] of resolvedRoles.entries()) {
    // 元 .val の消費(parts/ 内なら削除)は、全ピースを足しきる最後の1件だけに任せる(途中で消して後続が
    // PART_ADD_SOURCE_NOT_FOUND で落ちるのを防ぐ)。ただし skip が1件でもあれば消費しない(hasSkips。
    // skip 分の手動追加に元 .val が要る)。
    const isLastPiece = index === resolvedRoles.length - 1;

    const result = await addPartToProject({
      projectPath: options.cwd,
      valPath,
      name: piece.pieceName,
      role,
      type: "body",
      variant: "v1",
      piece: piece.pieceName,
      keepSource: hasSkips || !isLastPiece
    });

    if (!result.ok) {
      options.stderr(`${formatDiagnosticsText(result.diagnostics).join("\n")}\n`);
      return 1;
    }

    options.stdout(formatAddSuccess(result.value));
  }

  const skipNote = hasSkips
    ? " Skipped pieces above still need a manual loom add (their source .val was kept)."
    : "";
  options.stdout(
    `\nAdded ${resolvedRoles.length} parts (type "body", no connectors).${skipNote}\n` +
      "Declare seam connectors by editing each part.loom when ready. Next: loom check\n"
  );
  return 0;
}

// role 衝突する(= 同じ parts/ ディレクトリ / loomit.yml キーに解決される)ピース名を、書き込み前に洗い出す。
// seededKeys(既存 part の role)と、先行するピースの role の両方と照合する。判定用のコピーで回し seededKeys は破壊しない。
function collectCollidingPieceNames(
  pieces: readonly DetectedPiece[],
  seededKeys: ReadonlySet<string>,
  normalizeRoleKey: (role: string) => string
): readonly string[] {
  const simulated = new Set(seededKeys);
  const colliding: string[] = [];

  for (const piece of pieces) {
    const key = normalizeRoleKey(piece.pieceName);

    if (simulated.has(key)) {
      colliding.push(piece.pieceName);
    } else {
      simulated.add(key);
    }
  }

  return colliding;
}

// role 衝突したピースに distinct な role を訊く(B: --yes でも衝突分だけ対話する)。safe segment かつ、実 FS の
// case 感度で正規化して未使用になるまで訊き直す(既存 part や先に決めた role と重ならないよう takenRoleKeys で判定)。
// 冒頭の案内は衝突の理由で言い分ける: 元からプロジェクトにある role(existingRoleKeys)なら「もう add 済みかも」を
// 真っ先に伝え(一番効く情報)、そうでなければ .val 内で detail 名が重複しているサインとして伝える。
async function promptDistinctRole(
  prompter: Prompter,
  notify: (text: string) => void,
  pieceName: string,
  takenRoleKeys: ReadonlySet<string>,
  existingRoleKeys: ReadonlySet<string>,
  normalizeRoleKey: (role: string) => string
): Promise<string> {
  if (existingRoleKeys.has(normalizeRoleKey(pieceName))) {
    notify(
      `Part role "${pieceName}" already exists in this project — you may have already run loom add on this .val. ` +
        "Enter a distinct role to add another part, or press Ctrl+C to stop.\n"
    );
  } else {
    notify(
      `Detail "${pieceName}" repeats another piece in this .val; enter a distinct role for it.\n`
    );
  }

  for (;;) {
    const role = await promptSegment(prompter, notify, `Part role for "${pieceName}"`, undefined);

    if (takenRoleKeys.has(normalizeRoleKey(role))) {
      notify(`Role "${role}" is already taken; choose a distinct role.\n`);
      continue;
    }

    return role;
  }
}

// 実ファイルシステムが大文字小文字を区別するかを、プロジェクト正本 loomit.yml を綴り違いの名前で引けるか
// 試して判定する。プラットフォーム固定(macOS を一律 case-insensitive とする等)は case-sensitive な
// APFS/HFS+ を誤判定し、--yes が Front/front を不要に弾く。実 FS を直接見ることでそれを避ける。判定材料が
// 無いときは衝突を拾う側(insensitive)に倒す(部分適用を防ぐ方を優先)。
async function isCaseInsensitiveFsAt(projectFilePath: string): Promise<boolean> {
  const base = basename(projectFilePath);
  const flipped = flipAlphaCase(base);

  // 反転できる英字が無ければ判定材料が無い(loomit.yml では通常起きない)。安全側に倒す。
  if (flipped === base) {
    return true;
  }

  try {
    await access(join(dirname(projectFilePath), flipped));
    return true; // 綴り違いで引けた = 区別しない FS
  } catch {
    return false; // 引けない = 区別する FS(正本の存在は loadProject で確認済み)
  }
}

// 英字だけ大文字↔小文字を反転する(FS の case 感度プローブ用)。
function flipAlphaCase(value: string): string {
  let flipped = "";

  for (const ch of value) {
    const lower = ch.toLowerCase();
    flipped += ch === lower ? ch.toUpperCase() : lower;
  }

  return flipped;
}

// role に使う名前のうち、role として衝突する(= 同じ parts/ ディレクトリ / loomit.yml キーに解決される)
// ものを、原文の綴りのまま初出順で返す。addPartToProject は完全一致で role を登録し、ディレクトリ生成は
// FS の case 感度に従うので、caseInsensitive=true のときは小文字化して比較し大文字小文字違いも衝突として拾う
// (false=case-sensitive な Linux 等では完全一致のみ)。純関数にして両モードを決定的にテストできるようにする。
export function findCollidingRoleNames(
  names: readonly string[],
  caseInsensitive: boolean
): readonly string[] {
  const firstByKey = new Map<string, string>();
  const colliding: string[] = [];

  for (const name of names) {
    const key = caseInsensitive ? name.toLowerCase() : name;
    const first = firstByKey.get(key);

    if (first === undefined) {
      firstByKey.set(key, name);
      continue;
    }

    // 衝突。最初に見た綴りと今の綴りの両方を報告に含める(ケース違いも一目で分かるように)。
    if (!colliding.includes(first)) {
      colliding.push(first);
    }
    if (!colliding.includes(name)) {
      colliding.push(name);
    }
  }

  return colliding;
}

async function collectAnswers(
  prompter: Prompter,
  notify: (text: string) => void,
  defaultName: string,
  listJoins: () => Promise<readonly ExistingJoin[]>
): Promise<PartAnswers> {
  const name = await promptName(prompter, notify, defaultName);
  const type = await promptType(prompter, notify);
  const variant = await prompter.input("Variant", { default: "v1" });
  const connectors = await promptConnectors(prompter, notify, listJoins);

  return { name, type, variant, connectors };
}

// detail(ピース)1件分の回答を集める。role は detail 名を既定にするが、パス segment になるので安全な
// ときだけ既定に置き、非安全(空白/日本語等)なら手入力必須にする。name はラベルなので detail 名を
// そのまま既定に置き、安全 segment 制約は課さない(空白/日本語のラベルも許す)。
async function collectDetailAnswers(
  prompter: Prompter,
  notify: (text: string) => void,
  detailName: string,
  listJoins: () => Promise<readonly ExistingJoin[]>
): Promise<DetailPartAnswers> {
  const role = await promptSegment(
    prompter,
    notify,
    "Part role",
    isSafePathSegment(detailName) ? detailName : undefined
  );
  const name = await promptName(prompter, notify, detailName);
  const type = await promptType(prompter, notify);
  const variant = await prompter.input("Variant", { default: "v1" });
  const connectors = await promptConnectors(prompter, notify, listJoins);

  return { role, name, type, variant, connectors };
}

async function promptType(prompter: Prompter, notify: (text: string) => void): Promise<string> {
  const chosen = await prompter.select("Part type", TYPE_CHOICES, { default: "body" });

  if (chosen !== "other") {
    return chosen;
  }

  return promptSegment(prompter, notify, "Custom type", undefined);
}

async function promptConnectors(
  prompter: Prompter,
  notify: (text: string) => void,
  listJoins: () => Promise<readonly ExistingJoin[]>
): Promise<readonly AddPartConnectorInput[]> {
  const connectors: AddPartConnectorInput[] = [];
  let more = await prompter.confirm("Add a seam connector?", { default: false });

  // 連結を足すと答えて初めて縫い合わせ候補を集める。足さないなら project を読まない(先読みしない)。
  if (!more) {
    return connectors;
  }

  // 候補は part 1つ分の対話中は不変(この part で足した id は下の chosenIds で別に除外する)。ので1回だけ解決する。
  const existingJoins = await listJoins();

  while (more) {
    // この part の add ループ中に既に選んだ id。これを渡し、次の新規 join の既定 id 生成と衝突判定が
    // 「今この part で使った id」も taken として見るようにする。無いと、同じ type を2本足すとき2本目も
    // 既定が同じ id を提案し、最後に duplicate として黙って捨てられ、「同 type で別 id」が成立しない。
    // 既存 open join 一覧からも選択済みは外す(同じ相手を二度提示して skip される導線を避ける)。
    const chosenIds = new Set(connectors.map((connector) => connector.id));
    const join = await promptJoin(prompter, notify, existingJoins, chosenIds);

    // 重複は id(=record key/rendezvous)で判定する。同じ type の別 id は別の縫い目なので重複ではない。
    // 上流(既定/衝突/一覧除外)で防いでいるが、既存 join を二度選んだ場合の最終セーフティネットとして残す。
    if (connectors.some((connector) => connector.id === join.id)) {
      notify(`Connector "${join.id}" is already added; skipping duplicate.\n`);
    } else {
      const lengthMm = await promptOptionalLengthMm(prompter, notify, join.id);
      const base: AddPartConnectorInput = { id: join.id, type: join.type };
      connectors.push(lengthMm === undefined ? base : { ...base, lengthMm });
    }

    more = await prompter.confirm("Add another connector?", { default: false });
  }

  return connectors;
}

// 縫い合わせ先(join)を1つ決める。connector の本質は「名前付きの join」なので、seam の形ではなく
// 「どの join に繋ぐか」を尋ねる。既存の open join があればそこから選ばせ(選べば相手と id が一致して
// check がペアにし、type も継いで同じ縫い目の分類がそろう)、無い/新規を選んだときだけ新しい join を作る。
async function promptJoin(
  prompter: Prompter,
  notify: (text: string) => void,
  existingJoins: readonly ExistingJoin[],
  chosenIds: ReadonlySet<string>
): Promise<ChosenJoin> {
  // 縫い合わせ相手になれるのは「まだ1パーツしか宣言していない open な join(=相手待ち)」だけに絞る。
  // check は同じ id を宣言するパーツ同士を総当たりでペアにする(rules.ts comparePartConnectorLengths)ため、
  // 既に2パーツで閉じた join を3つ目にも選ばせると、狙った相手だけでなく既存の両者と多対多に繋がってしまう。
  // この part の add で既に選んだ id も外す(同じ相手を二度提示して duplicate skip される導線を避ける)。
  const openJoins = existingJoins.filter(
    (join) => join.roles.length === 1 && !chosenIds.has(join.id)
  );

  // 相手になりうる open join がまだ無い(最初のパーツ / 既存が全て閉じている)なら、新しい join を作る。
  if (openJoins.length === 0) {
    return promptNewJoin(prompter, notify, existingJoins, chosenIds);
  }

  // どの join がどのパーツのものかは select の番号一覧だけでは分からないため、先に宣言元 role と種類(type)付きで
  // 示す。id[type] を並べることで、id(一意な rendezvous)と type(種類ラベル)が別物だと対話上でも伝える。
  notify(
    "Existing joins (pick one to connect, or name a new one):\n" +
      openJoins.map((join) => `  ${join.id} [${join.type}] (${join.roles.join(", ")})`).join("\n") +
      "\n"
  );

  const choices = [...openJoins.map((join) => join.id), NAME_NEW_JOIN];
  // default は「新しい join を名付ける」に倒す。既存 join を default にすると、空 Enter や EOF で
  // (prompter.select はどちらでも default を返す)意図せず先頭の相手へ黙って接続してしまう。
  const chosen = await prompter.select("Connect to which join?", choices, {
    default: NAME_NEW_JOIN
  });

  if (chosen === NAME_NEW_JOIN) {
    return promptNewJoin(prompter, notify, existingJoins, chosenIds);
  }

  // 既存 open join を選んだら id と type を継ぐ(同じ縫い目なので種類も同じ)。相手と id が一致して check が
  // ペアにする。select は choices の値だけ返すので picked は必ず見つかるが、型を絞るための保険を置く。
  const picked = openJoins.find((join) => join.id === chosen);

  return picked ?? { id: chosen, type: chosen };
}

// 新しい join を作る。縫い目の種類(type)と一意な id を分けて受け取る。type はペアリングに使われない
// 種類ラベルなので複数の縫い目で同じでよく、区別は id が担う。id を潰さない限り、同じ type の別の縫い目を
// 足しても over-pair(CONNECTOR_JOIN_OVERPAIRED)しない。
async function promptNewJoin(
  prompter: Prompter,
  notify: (text: string) => void,
  existingJoins: readonly ExistingJoin[],
  chosenIds: ReadonlySet<string>
): Promise<ChosenJoin> {
  const type = await promptSeamType(prompter, notify);
  const id = await promptNewJoinId(prompter, notify, existingJoins, chosenIds, type);

  return { id, type };
}

// 縫い目の種類(connector.type)を訊く。id ではなく分類ラベルなので、よく使う縫い目種から選ばせ、
// 無ければ "other" で自由入力させる(type は schema 上パス segment ではないので空白入り等も許す)。
async function promptSeamType(prompter: Prompter, notify: (text: string) => void): Promise<string> {
  const chosen = await prompter.select("Seam type", SEAM_TYPE_CHOICES, { default: "side" });

  if (chosen !== "other") {
    return chosen;
  }

  return promptNonEmpty(prompter, notify, "Custom seam type");
}

// 新しい join の一意 id を単一 segment で受け取る。既定は type から導いた空き id(1本目の side は "side"、
// 埋まっていれば side_2…)なので、素直な縫い目なら Enter 1つで一意 id が付く。番兵は弾き、既存 id との
// 衝突(a: closed への相乗り=over-pair の事故、open への同名付け=一覧から選ぶべき)も弾いて訊き直す。
async function promptNewJoinId(
  prompter: Prompter,
  notify: (text: string) => void,
  existingJoins: readonly ExistingJoin[],
  chosenIds: ReadonlySet<string>,
  type: string
): Promise<string> {
  const suggested = suggestJoinId(type, existingJoins, chosenIds);

  for (;;) {
    const id = await promptSegment(prompter, notify, "Join id (unique per seam)", suggested);

    if (id === NAME_NEW_JOIN) {
      notify(`"${NAME_NEW_JOIN}" is reserved; choose a different join id.\n`);
      continue;
    }

    // この part で既にこの add ループ中に使った id との衝突。相手は自分自身なので「一覧から選べ」ではなく
    // 単に別 id を促す(既存 join への衝突とは文言を分ける)。
    if (chosenIds.has(id)) {
      notify(`Join id "${id}" is already added to this part; choose a distinct id.\n`);
      continue;
    }

    const clash = existingJoins.find((join) => join.id === id);

    if (clash !== undefined) {
      notify(formatJoinIdClash(id, clash));
      continue;
    }

    return id;
  }
}

// 既存 id と衝突したときの案内。closed(2パーツで縫い合わせ済み)への相乗りは over-pair の事故なので
// 「別 id を」、open(相手待ち)への同名付けは「一覧から選んで繋ぐか、別 id を」と、直し方を分けて示す。
function formatJoinIdClash(id: string, clash: ExistingJoin): string {
  const roles = clash.roles.join(" ↔ ");

  if (clash.roles.length >= 2) {
    return `Join id "${id}" is already a closed seam (${roles}). Give this seam a distinct id.\n`;
  }

  return (
    `Join id "${id}" is already an open join from ${roles}. ` +
    "Pick it from the list to connect, or choose a distinct id.\n"
  );
}

// type から新しい join id の既定を導く。type がそのまま単一 segment で空いていれば type を使い、
// 埋まっていれば type_2, type_3… と空き番号を探す(2本目の side は別の縫い目なので別 id になる)。
// type がパス segment にならない(空白入り等)ときは base を "seam" に倒す。
function suggestJoinId(
  type: string,
  existingJoins: readonly ExistingJoin[],
  chosenIds: ReadonlySet<string>
): string {
  const taken = new Set([...existingJoins.map((join) => join.id), ...chosenIds]);
  const base = isSafePathSegment(type) ? type : "seam";

  if (!taken.has(base)) {
    return base;
  }

  for (let n = 2; ; n += 1) {
    const candidate = `${base}_${n}`;

    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

// プロジェクト内の他パーツが宣言している join を、id・種類(type)・宣言元 role をまとめて集める。
// id ごとにまとめて id 昇順で返す。type は最初に見た宣言元の値を採る(継承していれば両者で一致する)。
// project が読めない/解決できないときは候補なし([])で返し、add を止めない(縫い合わせ相手が居ないだけ
// なので、新規 join を名付ける導線に倒す)。
async function collectExistingJoins(projectPath: string): Promise<readonly ExistingJoin[]> {
  const loaded = await loadProject(projectPath);

  if (!loaded.ok) {
    return [];
  }

  const resolved = await resolveParts(loaded.value);

  if (!resolved.ok) {
    return [];
  }

  const byJoinId = new Map<string, { type: string; roles: string[] }>();

  for (const part of Object.values(resolved.value.parts)) {
    for (const [joinId, connector] of Object.entries(part.part.connectors ?? {})) {
      const entry = byJoinId.get(joinId);

      if (entry === undefined) {
        byJoinId.set(joinId, { type: connector.type, roles: [part.role] });
      } else {
        entry.roles.push(part.role);
      }
    }
  }

  return sortJoins(byJoinId);
}

// draw ごとの detail 一覧を、(draw 名, ピース名)の平らな列に均す。add はこの順にピースを訊いていく。
function flattenDetectedPieces(detailList: {
  readonly draws: readonly {
    readonly drawName: string;
    readonly details: readonly string[];
  }[];
}): readonly DetectedPiece[] {
  return detailList.draws.flatMap((draw) =>
    draw.details.map((pieceName) => ({ drawName: draw.drawName, pieceName }))
  );
}

// 今どのピースを訊いているかを示す見出し。どの draw の detail かも添えて、複数ピースでも迷子にしない。
function formatPiecePromptHeader(piece: DetectedPiece): string {
  return `Piece: ${piece.pieceName} (draw: ${piece.drawName})\n`;
}

// ベース(既存パーツが宣言済みの join)と、この add で足したピースの join(addedJoins)を id ごとに合流し、
// id 昇順で返す。type はベース優先で運び(継承していれば両者で一致する)、同じ id は roles を和(重複なし)に
// する。ベースを遅延ロードした結果このピースが既に含まれても、roles の重複を除くので二重にならない。
function combineJoins(
  base: readonly ExistingJoin[],
  added: ReadonlyMap<string, { readonly type: string; readonly roles: readonly string[] }>
): readonly ExistingJoin[] {
  const byJoinId = new Map<string, { type: string; roles: string[] }>();

  for (const join of base) {
    byJoinId.set(join.id, { type: join.type, roles: [...join.roles] });
  }

  for (const [joinId, join] of added) {
    const entry = byJoinId.get(joinId);

    if (entry === undefined) {
      byJoinId.set(joinId, { type: join.type, roles: [...join.roles] });
    } else {
      for (const role of join.roles) {
        if (!entry.roles.includes(role)) {
          entry.roles.push(role);
        }
      }
    }
  }

  return sortJoins(byJoinId);
}

// join の Map(id -> {type, roles})を id 昇順の ExistingJoin[] に均す。collect と merge が同じ整列で
// 候補を返すための共有ヘルパ。
function sortJoins(
  byJoinId: ReadonlyMap<string, { readonly type: string; readonly roles: readonly string[] }>
): readonly ExistingJoin[] {
  return [...byJoinId.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, { type, roles }]) => ({ id, type, roles }));
}

// 空でない自由文字列を、非空になるまで訊き直す(seam の Custom type 用)。connector.type は schema 上
// パス segment ではない(slashes 等も許す)ので isSafePathSegment は課さないが、min(1) を満たすため空だけ弾く。
async function promptNonEmpty(
  prompter: Prompter,
  notify: (text: string) => void,
  label: string
): Promise<string> {
  for (;;) {
    const value = await prompter.input(label);

    if (value.length > 0) {
      return value;
    }

    notify("Enter a value.\n");
  }
}

// パス segment になる値(role / Custom type / New join id)を、単一 segment を満たすまで訊き直す。
// core も同じ検証をするが、失敗させる前にここで直せるようにする。
async function promptSegment(
  prompter: Prompter,
  notify: (text: string) => void,
  label: string,
  defaultValue: string | undefined
): Promise<string> {
  for (;;) {
    const value = await prompter.input(
      label,
      defaultValue === undefined ? {} : { default: defaultValue }
    );

    if (isSafePathSegment(value)) {
      return value;
    }

    // isSafePathSegment が弾くのは「空 / "." / ".." / 区切り文字」。spaces は許容するので文言に含めない
    // (メッセージが実際の検証と食い違わないようにする)。
    notify('Use a single name without slashes or "..".\n');
  }
}

// name は part.loom のラベルで、パスにもキーにも使わない(schema は z.string().min(1) の自由文字列)。
// role のような単一 segment 制約は課さず、detail 名の空白/日本語をそのまま既定として受け入れる。
// 空だけは schema の min(1) に反するので、空にならないよう既定を持たせて訊き、空回答は問い直す。
async function promptName(
  prompter: Prompter,
  notify: (text: string) => void,
  defaultValue: string
): Promise<string> {
  for (;;) {
    const value = await prompter.input("Part name", { default: defaultValue });

    if (value.length > 0) {
      return value;
    }

    notify("Enter a part name.\n");
  }
}

// length_mm は seam path の弧長=幾何の測定値で、.val を評価しないと出ない(Loomit は幾何を計算しない: A案)。
// ここで手打ちを強制せず、分かっていれば受け取り、空 Enter なら未測定のまま進める。未測定の値は後で
// Valentina / seamlint / truer が測って埋める(connector は identity だけでも成立するよう length_mm を optional 化済み)。
async function promptOptionalLengthMm(
  prompter: Prompter,
  notify: (text: string) => void,
  seam: string
): Promise<number | undefined> {
  for (;;) {
    const raw = await prompter.input(`${seam} length_mm (optional, Enter to measure later)`);

    if (raw === "") {
      return undefined;
    }

    const value = Number(raw);

    if (Number.isFinite(value) && value >= 0) {
      return value;
    }

    notify("Enter a non-negative number in mm (e.g. 469), or leave blank to measure later.\n");
  }
}

function formatAddSuccess(added: AddedPart): string {
  const projectRoot = dirname(added.projectFilePath);
  const rel = (target: string): string => relative(projectRoot, target).split("\\").join("/");

  return (
    [
      `Added part "${added.name}" as role "${added.role}":`,
      `  ${rel(added.sourceFilePath)}   (placed)`,
      `  ${rel(added.partFilePath)}   (generated)`,
      `  ${rel(added.projectFilePath)}   (registered)`,
      "",
      "Next: loom check"
    ].join("\n") + "\n"
  );
}

function parseAddArgs(args: readonly string[]): ParsedAddArgs | string {
  let help = false;
  let yes = false;
  const positional: string[] = [];

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (arg === "--yes" || arg === "-y") {
      yes = true;
      continue;
    }

    if (arg.startsWith("--")) {
      return `Unknown option: ${arg}`;
    }

    positional.push(arg);
  }

  if (positional.length > 1) {
    return "Expected a single path to a .val file.";
  }

  const valPath = positional[0];

  return valPath === undefined ? { help, yes } : { help, yes, valPath };
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}
