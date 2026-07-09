import { basename, dirname, relative, resolve } from "node:path";

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
// (slash も ".." も含まない)ため、実 join 名としては promptNewJoinName で拒否する。許してしまうと、
// 次回以降その join を選んでも番兵と誤認され、同名 join を再利用できなくなる。
const NAME_NEW_JOIN = "(name a new join)";

// プロジェクト内に既にある join(縫い合わせ先候補)。id と、それを宣言しているパーツ(role)を持つ。
interface ExistingJoin {
  readonly id: string;
  readonly roles: readonly string[];
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

  // 縫い合わせ相手の候補として、プロジェクト内の他パーツが既に宣言している join(connector id)を集める。
  // 取得できなくても add は続行する(最初のパーツや壊れた project では単に候補なしで新規命名に倒す)。
  // 1回の add で複数ピースを足すときは、直前に足したピースの join も候補に加えていく(mergeExistingJoins)。
  let existingJoins = await collectExistingJoins(options.cwd);
  const prompter = options.prompter ?? createReadlinePrompter();

  try {
    // detail を割り出せない .val(draw も detail も無い等)は、旧来の 1 .val=1 part 経路に倒す。
    if (detectedPieces.length === 0) {
      const answers = await collectAnswers(prompter, options.stdout, defaultName, existingJoins);
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
        existingJoins
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
      // 足したばかりの part の join を候補に反映し、次のピースが同じ join を選んで繋げられるようにする。
      existingJoins = mergeExistingJoins(
        existingJoins,
        result.value.role,
        Object.keys(result.value.part.connectors ?? {})
      );
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
  return [
    "Usage: loom add <file.val>",
    "",
    "Add a Valentina .val to the project. If Loomit detects <detail> pieces,",
    "it scaffolds one part per piece and records files.piece in each part. If",
    "the file has draws but no pieces yet, Loomit prints guidance and adds",
    "nothing. Otherwise it falls back to the legacy single-part prompt.",
    "",
    "Options:",
    "  --help  Show this help."
  ].join("\n") + "\n";
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

async function collectAnswers(
  prompter: Prompter,
  notify: (text: string) => void,
  defaultName: string,
  existingJoins: readonly ExistingJoin[]
): Promise<PartAnswers> {
  const name = await promptName(prompter, notify, defaultName);
  const type = await promptType(prompter, notify);
  const variant = await prompter.input("Variant", { default: "v1" });
  const connectors = await promptConnectors(prompter, notify, existingJoins);

  return { name, type, variant, connectors };
}

// detail(ピース)1件分の回答を集める。role は detail 名を既定にするが、パス segment になるので安全な
// ときだけ既定に置き、非安全(空白/日本語等)なら手入力必須にする。name はラベルなので detail 名を
// そのまま既定に置き、安全 segment 制約は課さない(空白/日本語のラベルも許す)。
async function collectDetailAnswers(
  prompter: Prompter,
  notify: (text: string) => void,
  detailName: string,
  existingJoins: readonly ExistingJoin[]
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
  const connectors = await promptConnectors(prompter, notify, existingJoins);

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
  existingJoins: readonly ExistingJoin[]
): Promise<readonly AddPartConnectorInput[]> {
  const connectors: AddPartConnectorInput[] = [];
  let more = await prompter.confirm("Add a seam connector?", { default: false });

  while (more) {
    const join = await promptJoin(prompter, notify, existingJoins);

    if (connectors.some((connector) => connector.id === join)) {
      notify(`Connector "${join}" is already added; skipping duplicate.\n`);
    } else {
      const lengthMm = await promptOptionalLengthMm(prompter, notify, join);
      connectors.push(lengthMm === undefined ? { id: join } : { id: join, lengthMm });
    }

    more = await prompter.confirm("Add another connector?", { default: false });
  }

  return connectors;
}

// 縫い合わせ先(join)を1つ決める。connector の本質は「名前付きの join」なので、seam の形ではなく
// 「どの join に繋ぐか」を尋ねる。既存の join があればそこから選ばせ(選べば相手と id が一致して check が
// ペアにする)、無い/新規を選んだときだけ join 名を付けさせる。
async function promptJoin(
  prompter: Prompter,
  notify: (text: string) => void,
  existingJoins: readonly ExistingJoin[]
): Promise<string> {
  // 縫い合わせ相手になれるのは「まだ1パーツしか宣言していない open な join(=相手待ち)」だけに絞る。
  // check は同じ id を宣言するパーツ同士を総当たりでペアにする(rules.ts comparePartConnectorLengths)ため、
  // 既に2パーツで閉じた join を3つ目にも選ばせると、狙った相手だけでなく既存の両者と多対多に繋がってしまう。
  const openJoins = existingJoins.filter((join) => join.roles.length === 1);

  // 相手になりうる open join がまだ無い(最初のパーツ / 既存が全て閉じている)なら、新しい join を名付けてもらう。
  if (openJoins.length === 0) {
    return promptNewJoinName(prompter, notify);
  }

  // どの join がどのパーツのものかは select の番号一覧だけでは分からないため、先に宣言元 role 付きで示す。
  notify(
    "Existing joins (pick one to connect, or name a new one):\n" +
      openJoins.map((join) => `  ${join.id} (${join.roles.join(", ")})`).join("\n") +
      "\n"
  );

  const choices = [...openJoins.map((join) => join.id), NAME_NEW_JOIN];
  // default は「新しい join を名付ける」に倒す。既存 join を default にすると、空 Enter や EOF で
  // (prompter.select はどちらでも default を返す)意図せず先頭の相手へ黙って接続してしまう。
  const chosen = await prompter.select("Connect to which join?", choices, {
    default: NAME_NEW_JOIN
  });

  if (chosen !== NAME_NEW_JOIN) {
    return chosen;
  }

  return promptNewJoinName(prompter, notify);
}

// 新しい join 名を単一 segment で受け取る。番兵 NAME_NEW_JOIN は isSafePathSegment を通ってしまうので、
// 実 join 名としてはここで弾く(通すと次回以降その join を選べなくなる)。
async function promptNewJoinName(
  prompter: Prompter,
  notify: (text: string) => void
): Promise<string> {
  for (;;) {
    const name = await promptSegment(prompter, notify, "New join name", undefined);

    if (name !== NAME_NEW_JOIN) {
      return name;
    }

    notify(`"${NAME_NEW_JOIN}" is reserved; choose a different join name.\n`);
  }
}

// プロジェクト内の他パーツが宣言している join(connector id)を、宣言元 role 付きで集める。id ごとに
// まとめて id 昇順で返す。project が読めない/解決できないときは候補なし([])で返し、add を止めない
// (縫い合わせ相手が居ないだけなので、新規 join を名付ける導線に倒す)。
async function collectExistingJoins(projectPath: string): Promise<readonly ExistingJoin[]> {
  const loaded = await loadProject(projectPath);

  if (!loaded.ok) {
    return [];
  }

  const resolved = await resolveParts(loaded.value);

  if (!resolved.ok) {
    return [];
  }

  const rolesByJoinId = new Map<string, string[]>();

  for (const part of Object.values(resolved.value.parts)) {
    for (const joinId of Object.keys(part.part.connectors ?? {})) {
      const roles = rolesByJoinId.get(joinId) ?? [];
      roles.push(part.role);
      rolesByJoinId.set(joinId, roles);
    }
  }

  return [...rolesByJoinId.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, roles]) => ({ id, roles }));
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

// 直前に足した part の join を候補一覧に反映する(1回の add で続けて足すピースが同じ join を選べるように)。
// collectExistingJoins と同じく id 昇順で返し、同じ role の重複登録はしない。
function mergeExistingJoins(
  existingJoins: readonly ExistingJoin[],
  role: string,
  joinIds: readonly string[]
): readonly ExistingJoin[] {
  const rolesByJoinId = new Map(existingJoins.map((join) => [join.id, [...join.roles]]));

  for (const joinId of joinIds) {
    const roles = rolesByJoinId.get(joinId) ?? [];

    if (!roles.includes(role)) {
      roles.push(role);
    }

    rolesByJoinId.set(joinId, roles);
  }

  return [...rolesByJoinId.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, roles]) => ({ id, roles }));
}

// パス segment になる値(role / Custom type / New join 名)を、単一 segment を満たすまで訊き直す。
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

  return [
    `Added part "${added.name}" as role "${added.role}":`,
    `  ${rel(added.sourceFilePath)}   (placed)`,
    `  ${rel(added.partFilePath)}   (generated)`,
    `  ${rel(added.projectFilePath)}   (registered)`,
    "",
    "Next: loom check"
  ].join("\n") + "\n";
}

function parseAddArgs(args: readonly string[]): ParsedAddArgs | string {
  let help = false;
  const positional: string[] = [];

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      help = true;
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

  return valPath === undefined ? { help } : { help, valPath };
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}
