import { basename, dirname, relative, resolve } from "node:path";

import {
  addPartToProject,
  checkValSourceExists,
  collectCollidingPieceNames,
  collectExistingJoins,
  combineJoins,
  findCollidingRoleNames,
  findUnregisteredValSources,
  flattenDetectedPieces,
  isCaseInsensitiveFileSystemAt,
  isSafePathSegment,
  listValDetailsFromFile,
  loadProject,
  resolveParts,
  suggestJoinId
} from "loomit-core";
import type {
  AddedPart,
  AddPartConnectorInput,
  DetectedPiece,
  Diagnostic,
  ExistingJoin,
  UnregisteredValSource
} from "loomit-core";
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

// 「連結を足すのはやめる」を表す select の番兵。「Add a seam connector?」に yes と答えた後で降りるための
// 出口で、繋ぎたかった縫い目がここでは繋げない(side 付き)と分かったときに要る。番兵は isSafePathSegment を
// 通ってしまうため、実 join id としては promptNewJoinId が拒否する(NAME_NEW_JOIN と同じ理由)。
const SKIP_CONNECTOR = "(skip — add no connector)";

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

// 対話で決まった1つの縫い合わせ先。一意な id と種類 type を分けて持つ(buildConnectors がこの2軸を書く)。
interface ChosenJoin {
  readonly id: string;
  readonly type: string;
}

// 縫い合わせ候補(既存 join)を集められなかった。診断を運んで対話ループの外まで抜ける。
// prompt 群の戻り値を全て result 型に変えるより、EndOfInputError と同じ throw/catch に揃える方が、
// 「対話の途中で打ち切る」という同じ性質の失敗を1か所で扱えて読みやすい。
class JoinLookupError extends Error {
  readonly diagnostics: readonly Diagnostic[];

  constructor(diagnostics: readonly Diagnostic[]) {
    super("Could not collect existing seam joins.");
    this.name = "JoinLookupError";
    this.diagnostics = diagnostics;
  }
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

  if (parsedArgs.help) {
    options.stdout(formatAddHelp());
    return 0;
  }

  // 引数省略時に自動発見の選択で開いた readline。wizard 本体が同じ instance を引き継いで使う
  // (readline はパイプ入力を先読みして貯めるため、選択と wizard を別 instance に分けると2つ目が
  // 残りの行を受け取れず、`loom add < answers.txt` の非対話入力が壊れる)。--yes 経路では持ち帰らない。
  let carriedPrompter: Prompter | undefined;
  let valPath: string;

  if (parsedArgs.valPath === undefined) {
    // .val を指定しない add: 「まだ取り込まれていない .val」を check と同じ定義で探し、1つに定まれば
    // それを取り込む。1 project = 1着 = 1 .val が普通なので、大半の add は引数なしで足りる。
    const discovered = await discoverValToAdd(options, parsedArgs.yes);

    if (typeof discovered === "number") {
      return discovered;
    }

    valPath = discovered.valPath;
    carriedPrompter = discovered.prompter;
  } else {
    valPath = resolve(options.cwd, parsedArgs.valPath);
  }

  const defaultName = stripExtension(basename(valPath));

  // 対話を始める前に .val の存在を確認する。無ければ即座に失敗させ、name/type/seam を全部入力させた
  // 最後に「見つからない」と言う無駄をなくす(core も書き込み直前に同じ関門を持つ)。
  const missingSource = await checkValSourceExists(valPath);

  if (missingSource !== undefined) {
    options.stderr(`${formatDiagnosticsText([missingSource]).join("\n")}\n`);
    // wizard に達しない早期 return では、選択用に開いた readline をここで閉じる(開いた stdin が
    // process を生かし続けるため)。以降の早期 return も同様。
    carriedPrompter?.close();
    return 1;
  }

  // .val を read-only で覗いて <detail> ピースを列挙する。1着 = 1 .val = N ピースなので、ここで割り出した
  // ピースの数だけ part を作る(案B)。読めなければ幾何に触れる前に explainable な診断で止める。
  const detailList = await listValDetailsFromFile(valPath);

  if (!detailList.ok) {
    options.stderr(`${formatDiagnosticsText(detailList.diagnostics).join("\n")}\n`);
    carriedPrompter?.close();
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
    carriedPrompter?.close();
    return 0;
  }

  // detail(piece)名は piece の identity=DXF export の BLOCK 名=Seamlint の突き合わせ住所であり、.val 内で一意で
  // なければならない(Seamlint は BLOCK 名を大文字化して照合するので大小違いも衝突する)。同名 detail があると
  // role を分けても両 part の files.piece が同じ=同じ BLOCK に解決し、Seamlint が物理ピースを区別できず notch も
  // 片方 drop される(projectNotchesFromVal の PART_SOURCE_VAL_NOTCH_DUPLICATE_PIECE)。role 入力では直せない契約
  // 違反なので、対話 / --yes どちらの経路に入る前にもここで止め、何も書かず Valentina 側で名前を分けさせる。
  const duplicateDetailNames = findCollidingRoleNames(
    detectedPieces.map((piece) => piece.pieceName),
    true
  );

  if (duplicateDetailNames.length > 0) {
    options.stderr(
      `Duplicate detail name(s) in the .val (${duplicateDetailNames.join(", ")}). ` +
        "Detail names must be unique because each identifies a DXF block (matched case-insensitively), so two pieces " +
        "with the same name resolve to the same block and cannot be told apart. " +
        "Give each piece a distinct detail name in Valentina, then run loom add again.\n"
    );
    carriedPrompter?.close();
    return 1;
  }

  // --yes: 対話をせず、検出した全ピースをデフォルトで一括生成する。prompter を作る前に分岐して
  // stdin を開かない(パイプ / CI でも動く)。連結の候補集めも要らないので collectExistingJoins より前で返す。
  if (parsedArgs.yes) {
    return await addAllPiecesWithDefaults(options, valPath, detectedPieces, defaultName);
  }

  // 縫い合わせ相手の候補(join)は遅延ロードする。連結を1つも足さない add(「Add a seam connector?」に N)では
  // project を一切読まないよう、既存パーツが宣言済みの join(ベース)を初回に必要になったときだけ1回読んで
  // キャッシュする。それに、この add で続けて足したピースの join を重ねて返す(直前のピースが宣言した join を選べる)。
  //
  // 読めなかったときは候補なしに畳まず中断する。壊れた part.loom を「join が無い」と読み替えると、作者は
  // 既存の縫い目に繋いだつもりで新しい id を振ってしまい、part を直した後に意図しない同一 id 参加が現れる。
  // 積み上げ中は書き換えるので、公開型(readonly な JoinSide)ではなく可変の形で持つ。
  let baseJoins: readonly ExistingJoin[] | undefined;
  const addedJoins = new Map<
    string,
    { type: string; roles: string[]; sides: { side: string; roles: string[] }[] }
  >();

  const listJoins = async (): Promise<readonly ExistingJoin[]> => {
    if (baseJoins === undefined) {
      const result = await collectExistingJoins(options.cwd);

      if (!result.ok) {
        throw new JoinLookupError(result.diagnostics);
      }

      baseJoins = result.value;
    }

    return combineJoins(baseJoins, addedJoins);
  };

  // 足したばかりの part の connectors を候補に反映する(次のピースが同じ join(id と type)を選べるように)。
  // ベース未ロードでも記録だけしておき、次に候補が必要になったとき combineJoins でベースと合流する。
  // side も書かれていれば運ぶ。wizard は side を書かないので今は常に空だが、書き込み結果をそのまま読む形に
  // しておけば、side を書く経路が増えたときに候補一覧が黙って coincident 扱いに落ちることがない。
  const recordAddedJoins = (
    role: string,
    connectors:
      | Readonly<Record<string, { readonly type: string; readonly side?: string | undefined }>>
      | undefined
  ): void => {
    for (const [joinId, connector] of Object.entries(connectors ?? {})) {
      let entry = addedJoins.get(joinId);

      if (entry === undefined) {
        entry = { type: connector.type, roles: [], sides: [] };
        addedJoins.set(joinId, entry);
      }

      if (!entry.roles.includes(role)) {
        entry.roles.push(role);
      }

      if (connector.side === undefined) {
        continue;
      }

      const side = entry.sides.find((candidate) => candidate.side === connector.side);

      if (side === undefined) {
        entry.sides.push({ side: connector.side, roles: [role] });
      } else if (!side.roles.includes(role)) {
        side.roles.push(role);
      }
    }
  };

  // 引数省略の選択で開いた readline があればそれを引き継ぐ(選択と wizard で1 instance を共有し、
  // パイプ入力の残り行を取りこぼさない)。close は下の finally が担う。
  const prompter = carriedPrompter ?? options.prompter ?? createReadlinePrompter();

  try {
    // detail を割り出せない .val(draw も detail も無い等)は、旧来の 1 .val=1 part 経路に倒す。
    if (detectedPieces.length === 0) {
      const answers = await collectAnswers(prompter, options.stdout, defaultName, listJoins);
      return await addOnePart(options, valPath, answers);
    }

    for (const piece of detectedPieces) {
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

    // 縫い合わせ候補を集める段階で project / part.loom が読めなかったとき。診断をそのまま見せて止める
    // (候補なしとして続けると、既存の縫い目に繋げないまま別 id が生えるため)。
    if (error instanceof JoinLookupError) {
      options.stderr(`${formatDiagnosticsText(error.diagnostics).join("\n")}\n`);
      options.stderr(
        "Could not read the existing seam joins, so loom add stopped before writing this part.\n" +
          "Fix the reported files (or run loom check) and try again.\n"
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
      "Usage: loom add [file.val] [--yes]",
      "",
      "Add a Valentina .val to the project. If Loomit detects <detail> pieces,",
      "it scaffolds one part per piece and records files.piece in each part. If",
      "the file has draws but no pieces yet, Loomit prints guidance and adds",
      "nothing. Otherwise it falls back to the legacy single-part prompt.",
      "",
      "If file.val is omitted, loom add looks for a .val that is not yet",
      "registered as a part (in the project root and under parts/ — the same",
      "rule loom check uses). Exactly one match is added; several matches ask",
      "which one (with --yes only in an interactive terminal); none explains",
      "where to put the file.",
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

// 引数省略時の発見結果。prompter は、複数候補の選択のために自分で開いた readline(呼び手の wizard が
// 引き継いで close まで面倒を見る)。注入 prompter や --yes(選択後すぐ閉じる)では載せない。
interface DiscoveredVal {
  readonly valPath: string;
  readonly prompter?: Prompter;
}

// .val を指定しない add の自動発見。「まだ取り込まれていない .val」を check(UNREGISTERED_VAL_SOURCE)と
// 同じ実装(findUnregisteredValSources)で探す。root 直下も見るのは add だけ(初回 add は root に .val を
// 置く導線が普通。理由の詳細は core 側のコメント)。候補が1つならそれに確定、0なら案内、複数なら選択させる。
// 戻り値が number のときは exit code(発見だけで add を終える/失敗させる)。
async function discoverValToAdd(
  options: AddCommandOptions,
  yes: boolean
): Promise<DiscoveredVal | number> {
  const loaded = await loadProject(options.cwd);

  if (!loaded.ok) {
    options.stderr(`${formatDiagnosticsText(loaded.diagnostics).join("\n")}\n`);
    return 1;
  }

  const resolved = await resolveParts(loaded.value);

  // 壊れた part.loom があると「登録済み source」を正しく判定できず、取り込み済みの .val を再 add
  // しかねない。発見はあきらめて診断を見せる(明示パスの add は従来どおり可能)。
  if (!resolved.ok) {
    options.stderr(`${formatDiagnosticsText(resolved.diagnostics).join("\n")}\n`);
    return 1;
  }

  const scan = await findUnregisteredValSources(resolved.value, { includeProjectRoot: true });

  // 走査の失敗(権限エラー等)を「候補なし」に畳まない。空プロジェクトに見せかけて誤誘導せず、
  // errno 分類済みの診断を見せて失敗する(ENOENT=正常な不在は core 側で空扱い済み)。
  if (!scan.ok) {
    options.stderr(`${formatDiagnosticsText(scan.diagnostics).join("\n")}\n`);
    return 1;
  }

  // 内容読みの降格 warning(残骸判定を省略したファイル)は見せた上で続行する。
  if (scan.diagnostics.length > 0) {
    options.stderr(`${formatDiagnosticsText(scan.diagnostics).join("\n")}\n`);
  }

  const sources = scan.value;

  // 登録済み source と同一内容の残骸は候補にしない(check も「add でなく削除」を案内するもの。再 add
  // しても role の二重登録で行き止まりになる)。黙って無視もせず、なぜ候補でないかを見せる。
  for (const leftover of sources) {
    if (leftover.duplicateOf !== undefined) {
      options.stdout(
        `Skipped ${leftover.relativePath}: same content as the already-registered ${leftover.duplicateOf}; delete it if it is a leftover.\n`
      );
    }
  }

  const candidates = sources.filter((source) => source.duplicateOf === undefined);
  const first = candidates[0];

  if (first === undefined) {
    // 取り込めるものが何も無い。part も無いなら「まず .val を置く」を案内して失敗、part があるなら
    // 「全部取り込み済み」の正常系(再実行が role 衝突エラーの藪に落ちないための出口)。
    if (Object.keys(resolved.value.parts).length === 0) {
      options.stderr(
        "No .val file to add was found in this project.\n" +
          "Put your Valentina .val in the project root or under parts/, or pass a path: loom add <file.val>\n"
      );
      return 1;
    }

    options.stdout("Every .val in this project is already registered as a part; nothing to add.\n");
    return 0;
  }

  if (candidates.length === 1) {
    // 何を選んだかは必ず見せる(引数を省いても、どのファイルに手を付けるかは黙らない)。
    options.stdout(`Adding ${first.relativePath}.\n`);
    return { valPath: first.path };
  }

  // 複数候補。どれを取り込むかは決められないので選ばせる。--yes は automation を止めない契約なので、
  // 非対話(TTY でない CI / パイプ)では stdin を開かず、何も書かずに clean fail する(role 衝突時の
  // 対話と同じ TTY 限定パターン)。
  if (yes) {
    const prompter =
      options.prompter ?? (process.stdin.isTTY === true ? createReadlinePrompter() : undefined);

    if (prompter === undefined) {
      options.stderr(formatAmbiguousCandidates(candidates));
      return 1;
    }

    const ownPrompter = prompter !== options.prompter;

    try {
      return { valPath: await selectValToAdd(prompter, candidates) };
    } catch (error) {
      if (error instanceof EndOfInputError) {
        options.stderr(formatAmbiguousCandidates(candidates));
        return 1;
      }

      throw error;
    } finally {
      // --yes では選択が済んだら閉じる(TTY なので先読み行の取りこぼしは無い)。後段の role 衝突の
      // 対話は addAllPiecesWithDefaults が必要になったときだけ開き直す。
      if (ownPrompter) {
        prompter.close();
      }
    }
  }

  // wizard: 選択も本体の質問も1つの prompter で読む(パイプ入力の行を選択→wizard と跨いで消費するため)。
  // 自分で開いた readline は結果に載せて wizard に引き継ぎ、close は wizard の finally に任せる。
  const prompter = options.prompter ?? createReadlinePrompter();
  const ownPrompter = prompter !== options.prompter;

  try {
    const valPath = await selectValToAdd(prompter, candidates);
    return ownPrompter ? { valPath, prompter } : { valPath };
  } catch (error) {
    if (ownPrompter) {
      prompter.close();
    }

    if (error instanceof EndOfInputError) {
      options.stderr(formatAmbiguousCandidates(candidates));
      return 1;
    }

    throw error;
  }
}

// 複数候補から取り込む .val を1つ選ばせる。default は置かない: 空 Enter や EOF で先頭のファイルに黙って
// 確定して取り込むのは事故なので、明示的に選ぶまで問い直す(EOF は EndOfInputError で呼び手が clean fail)。
async function selectValToAdd(
  prompter: Prompter,
  candidates: readonly UnregisteredValSource[]
): Promise<string> {
  const chosen = await prompter.select(
    "Add which .val?",
    candidates.map((candidate) => candidate.relativePath)
  );
  const picked = candidates.find((candidate) => candidate.relativePath === chosen);

  // select は choices の値だけ返すので必ず見つかる。型を絞るための保険。
  if (picked === undefined) {
    throw new Error(`internal: selected .val "${chosen}" is not among the candidates`);
  }

  return picked.path;
}

// 複数候補を非対話で1つに絞れなかったときの案内。候補を全部見せて、明示パスでの再実行に導く。
function formatAmbiguousCandidates(candidates: readonly UnregisteredValSource[]): string {
  return (
    "Multiple unregistered .val files were found:\n" +
    candidates.map((candidate) => `  ${candidate.relativePath}`).join("\n") +
    "\nPass the one to add: loom add <file.val>\n"
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
    ? await isCaseInsensitiveFileSystemAt(loaded.value.paths.projectFilePath)
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
  const collidingPieceNames = collectCollidingPieceNames(
    addable.map((piece) => piece.pieceName),
    takenRoleKeys,
    normalizeRoleKey
  );

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

  for (const { piece, role } of resolvedRoles) {
    const result = await addPartToProject({
      projectPath: options.cwd,
      valPath,
      name: piece.pieceName,
      role,
      type: "body",
      variant: "v1",
      piece: piece.pieceName
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
    // 既存 join 一覧からも選択済みは外す(同じ相手を二度提示して skip される導線を避ける)。
    const chosenIds = new Set(connectors.map((connector) => connector.id));
    const join = await promptJoin(prompter, notify, existingJoins, chosenIds);

    // 「連結しない」を選んだ。ここまでに足した分はそのまま活かして、連結の対話だけ打ち切る。
    // 「Add a seam connector?」に yes と答えた後でも降りられる出口が要る ── とくに繋ぎたかった縫い目が
    // side 付き(ここでは繋げない)だったとき、逃げ道が無いと要らない join を発明させることになる。
    if (join === undefined) {
      break;
    }

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
// 「どの join に繋ぐか」を尋ねる。既存の join があればそこから選ばせ(選べば相手と id が一致して
// check がペアにし、type も継いで同じ縫い目の分類がそろう)、無い/新規を選んだときだけ新しい join を作る。
// undefined を返したら「連結を足すのはやめる」(呼び出し側は連結の対話を打ち切る)。
async function promptJoin(
  prompter: Prompter,
  notify: (text: string) => void,
  existingJoins: readonly ExistingJoin[],
  chosenIds: ReadonlySet<string>
): Promise<ChosenJoin | undefined> {
  // 参加パーツ数では絞らない。seam は作者が宣言する参加エッジの集合であって「1本の縫い目 = 2枚」ではなく、
  // 2パーツが宣言済みの join を「閉じている」と見て3枚目を拒むのは誤り。表地＋見返し＋裏地のような重ね
  // (coincident)は N 枚が同じ縫い目に参加するのが正しい宣言で、そこを塞ぐと作者は同じ縫い目に別 id を振る
  // 羽目になる(docs/glossary.md の Connector 節、design-history の「seam は参加エッジの集合、over-pair は
  // 退役」)。check 側も3枚以上の重ねを pairwise 比較から外して幾何は Seamlint に defer する
  // (rules.ts collectNonPairwiseJoinIds)ので、多対多に壊れることはない。
  //
  // 絞るのは side を宣言している縫い目(contiguous / band)だけ。ここに side 無しで id だけ足すと
  // classifyJoinSides が mixed と見て CONNECTOR_JOIN_SIDES_INCOMPLETE になり、band なら「和が band に等しい」
  // という不変条件も壊れる。正しく参加するには「自分がどちらの側か」の宣言が要るが、それは wizard が訊いても
  // 正しく答えられない ── band は定義上ちょうど1枚なので band 側を選ぶ答えはほぼ常に誤りで、neighbour 側を
  // 選ぶことは和の不変条件を動かす設計判断になる。band seam を**新規に**張るときは side を `connectBand`
  // (`loom connect --to`)が裏で書き、作者は触らない。既存の縫い目への参加は `loom connect --join` が
  // 受け持ち、side の指定と band を壊す側の拒否もそちらの guard が担う。よってここでは選ばせず、存在と
  // 理由とそのコマンドを示す。
  //
  // type が参加者間で割れている縫い目も選ばせない。選ぶと「継いだ type」が宣言順で決まる任意の値になり、
  // 割れを1枚ぶん広げてしまう(extendJoin も CONNECT_JOIN_TYPE_CONFLICT で同じ理由で拒否する)。
  const availableJoins = existingJoins.filter((join) => !chosenIds.has(join.id));
  const selectableJoins = availableJoins.filter(
    (join) => join.sides.length === 0 && join.types.length <= 1
  );
  const sidedJoins = availableJoins.filter((join) => join.sides.length > 0);
  const conflictedJoins = availableJoins.filter(
    (join) => join.sides.length === 0 && join.types.length > 1
  );
  // 実際に一覧へ出す id の集合。id 衝突の案内は「除外条件を書き写す」のでなく**この集合に居るか**で
  // 分岐する ── 除外理由を1つ足したときに、案内側だけ古いままで「一覧から選べ」と嘘をつくのを防ぐ。
  const selectableIds = new Set(selectableJoins.map((join) => join.id));

  if (conflictedJoins.length > 0) {
    notify(
      "Joins whose participants disagree on the seam type are not offered here (there is no type to inherit):\n" +
        conflictedJoins
          .map(
            (join) => `  ${join.id} (${join.roles.join(", ")}) — types: ${join.types.join(", ")}`
          )
          .join("\n") +
        "\nMake those parts agree on one connector type, then join with loom connect --join.\n"
    );
  }

  // side 付きの縫い目は選べないが、存在は伝える(黙って消すと「候補に無い=無い」と誤解され、作者は同じ縫い目に
  // 別 id を振ってしまう)。
  //
  // 行き先は `loom connect --join`(拡張モード)。`--as` の新規作成に既存 id を渡すと
  // CONNECT_ID_ALREADY_DECLARED で止まるので、そちらを案内してはいけない。
  if (sidedJoins.length > 0) {
    notify(
      "Joins with sides (contiguous / band seams) cannot be joined here — loom add does not write a side:\n" +
        sidedJoins.map(formatSidedJoin).join("\n") +
        "\nTo join one, finish this add and run:\n" +
        `  loom connect <role> --join ${sidedJoins[0]?.id ?? "<id>"} --side <side>\n` +
        "It refuses a side that would break the seam (a band must stay one piece) and tells you which\n" +
        "side to use instead.\n"
    );
  }

  // 選べる既存 join がまだ無い。最初のパーツなら従来どおり新しい join を作る導線へ直行する(余計な質問を
  // 足さない)。side 付きしか無いときだけは、繋ぎたかった相手に繋げないと分かった直後なので、要らない join を
  // 発明させずに降りられる出口も出す。
  if (selectableJoins.length === 0) {
    if (sidedJoins.length === 0 && conflictedJoins.length === 0) {
      return promptNewJoin(prompter, notify, existingJoins, chosenIds, selectableIds);
    }

    // default は skip に倒す。空 Enter や EOF でも(prompter.select はどちらでも default を返す)、繋げない
    // 縫い目の代わりに意味の無い join が生まれるより、connector 無しで add を終えられる方が安全。
    const chosenWithoutCandidates = await prompter.select(
      "No joinable seam here. What now?",
      [SKIP_CONNECTOR, NAME_NEW_JOIN],
      { default: SKIP_CONNECTOR }
    );

    if (chosenWithoutCandidates === SKIP_CONNECTOR) {
      return undefined;
    }

    return promptNewJoin(prompter, notify, existingJoins, chosenIds, selectableIds);
  }

  // どの join がどのパーツのものかは select の番号一覧だけでは分からないため、先に宣言元 role と種類(type)付きで
  // 示す。id[type] を並べることで、id(一意な rendezvous)と type(種類ラベル)が別物だと対話上でも伝える。
  // 相手待ち(1パーツ)か、既に複数パーツが参加しているかも添える。どちらも繋いでよいが、意味は違う
  // (前者は相方を待っている縫い目、後者は重ね縫いに1枚足すことになる)ので、選ぶ前に見えるようにする。
  notify(
    "Existing joins (pick one to connect, or name a new one):\n" +
      selectableJoins
        .map(
          (join) =>
            `  ${join.id} [${join.type}] (${join.roles.join(", ")}${
              join.roles.length === 1 ? " — waiting for a mate" : ` — ${join.roles.length} parts`
            })`
        )
        .join("\n") +
      "\n"
  );

  // 「やめる」も常に出す。yes と答えた後で降りられないと、繋ぎたい相手が居ないときに要らない join を
  // 発明するしかなくなる(side 付きしか無い場合は上で同じ出口を出している)。
  const choices = [...selectableJoins.map((join) => join.id), NAME_NEW_JOIN, SKIP_CONNECTOR];
  // default は「新しい join を名付ける」に倒す。既存 join を default にすると、空 Enter や EOF で
  // (prompter.select はどちらでも default を返す)意図せず先頭の相手へ黙って接続してしまう。
  const chosen = await prompter.select("Connect to which join?", choices, {
    default: NAME_NEW_JOIN
  });

  if (chosen === SKIP_CONNECTOR) {
    return undefined;
  }

  if (chosen === NAME_NEW_JOIN) {
    return promptNewJoin(prompter, notify, existingJoins, chosenIds, selectableIds);
  }

  // 既存 join を選んだら id と type を継ぐ(同じ縫い目なので種類も同じ)。相手と id が一致して check が
  // ペアにする。select は choices の値だけ返すので picked は必ず見つかるが、型を絞るための保険を置く。
  const picked = selectableJoins.find((join) => join.id === chosen);

  return picked ?? { id: chosen, type: chosen };
}

// 新しい join を作る。縫い目の種類(type)と一意な id を分けて受け取る。type はペアリングに使われない
// 種類ラベルなので複数の縫い目で同じでよく、区別は id が担う。同じ type の別の縫い目を足しても、
// id さえ分けてあれば別の縫い目として扱われる(check がペアにするのは id の一致だけ)。
async function promptNewJoin(
  prompter: Prompter,
  notify: (text: string) => void,
  existingJoins: readonly ExistingJoin[],
  chosenIds: ReadonlySet<string>,
  selectableIds: ReadonlySet<string>
): Promise<ChosenJoin> {
  const type = await promptSeamType(prompter, notify);
  const id = await promptNewJoinId(prompter, notify, existingJoins, chosenIds, selectableIds, type);

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
// 衝突も弾いて訊き直す(既存の縫い目に参加したいなら一覧から選ぶ導線があり、そちらなら type も継げる)。
async function promptNewJoinId(
  prompter: Prompter,
  notify: (text: string) => void,
  existingJoins: readonly ExistingJoin[],
  chosenIds: ReadonlySet<string>,
  selectableIds: ReadonlySet<string>,
  type: string
): Promise<string> {
  const suggested = suggestJoinId(type, existingJoins, chosenIds);

  for (;;) {
    const id = await promptSegment(prompter, notify, "Join id (unique per seam)", suggested);

    // select の番兵はどちらも isSafePathSegment を通ってしまう。実 join id として許すと、次回以降その id を
    // 選んでも番兵と誤認され、同名 join を再利用できなくなる。
    if (id === NAME_NEW_JOIN || id === SKIP_CONNECTOR) {
      notify(`"${id}" is reserved; choose a different join id.\n`);
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
      notify(formatJoinIdClash(id, clash, selectableIds.has(id)));
      continue;
    }

    return id;
  }
}

// side 付きの縫い目1本を、参加者と側ごとの内訳つきで示す。
//
// **どの側に足してよいかの判断は、ここでは持たない。** それは band の不変条件(band はちょうど1枚)に依存し、
// 同じ規則を wizard の文面として書き写すと本体と drift する ── 実際そうなっていた。判断は
// `loom connect --join` の guard(core の extendJoin)が持ち、間違った側は拒否して正しい側を名指しする。
// ここは「どの縫い目があり、側がどう分かれているか」を見せて、その guard へ送るだけにする。
function formatSidedJoin(join: ExistingJoin): string {
  const sides = join.sides.map((side) => `${side.side}: ${side.roles.join(", ")}`).join(" | ");

  return `  ${join.id} [${join.type}] (${join.roles.join(", ")})\n    sides: ${sides}`;
}

// 既存 id と衝突したときの案内。参加パーツ数で文言を分けない ── 何枚が参加していようと直し方は同じで、
// 「その縫い目に参加したいなら一覧から選ぶ(type も継げる)、別の縫い目なら別 id を付ける」の2択になる。
// 手打ちの同名をそのまま通さないのは、参加したいのか別の縫い目なのかが id だけでは区別できないため。
// **「一覧から選べ」と言えるのは、その縫い目が実際に一覧に出ているときだけ。** 候補から外している縫い目に
// それを言うと、存在しない行き先へ送ることになる。
//
// そこで判定は **isSelectable(実際に一覧へ出した id の集合に居るか)** で行い、除外条件そのものを書き写さない。
// 書き写すと、除外理由を1つ足したときにこちらだけ古いままになって嘘をつく(実際に side 付き・type 競合の
// 2回そうなった)。下の理由分岐は「なぜ出していないか」を添えるための補足で、未知の理由に落ちても最後の
// 汎用文が残る ── 詳しさは失うが、「一覧には無い」は嘘にならない。
function formatJoinIdClash(id: string, clash: ExistingJoin, isSelectable: boolean): string {
  const roles = clash.roles.join(", ");

  if (isSelectable) {
    return (
      `Join id "${id}" is already declared by ${roles}. ` +
      "Pick it from the list to join that seam, or choose a distinct id for a different seam.\n"
    );
  }

  if (clash.sides.length > 0) {
    return (
      `Join id "${id}" is already a seam with sides (${roles}). It needs a side, so it cannot be ` +
      `declared here:\n${formatSidedJoin(clash)}\n` +
      `Join it after this add with: loom connect <role> --join ${id} --side <side>. ` +
      "Choose a distinct id if you meant a different seam.\n"
    );
  }

  if (clash.types.length > 1) {
    return (
      `Join id "${id}" is already declared by ${roles}, but they disagree on its type ` +
      `(${clash.types.join(", ")}), so there is no type to inherit and it is not offered here. ` +
      `Make those parts agree on one connector type, then join with ` +
      `loom connect <role> --join ${id}. Choose a distinct id if you meant a different seam.\n`
    );
  }

  // 一覧に出していないが、理由をここで説明できない(将来の除外理由)。行き先だけは実在するものを示す。
  return (
    `Join id "${id}" is already declared by ${roles} and is not offered as a candidate here. ` +
    `Join it after this add with: loom connect <role> --join ${id}. ` +
    "Choose a distinct id if you meant a different seam.\n"
  );
}

// 今どのピースを訊いているかを示す見出し。どの draw の detail かも添えて、複数ピースでも迷子にしない。
function formatPiecePromptHeader(piece: DetectedPiece): string {
  return `Piece: ${piece.pieceName} (draw: ${piece.drawName})\n`;
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
// Seamlint(loom slnt check)が実測する(connector は identity だけでも成立するよう length_mm を optional 化済み)。
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
      // .val をコピーしたのは project 外から取り込んだときだけ。project 内の .val はその場を参照する
      // ので「置いた」と書くと嘘になる(複製が増えていないことが読み手に伝わるようにする)。
      `  ${rel(added.sourceFilePath)}   (${added.sourceCopied ? "placed" : "referenced"})`,
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
