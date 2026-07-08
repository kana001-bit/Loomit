import { basename, dirname, relative, resolve } from "node:path";

import {
  addPartToProject,
  checkValSourceExists,
  isSafePathSegment,
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

// type は garment 上の役割。schema は自由な単一 segment だが、よく使う候補を出して選びやすくする。
const TYPE_CHOICES = ["body", "sleeve", "collar", "cuff", "facing", "other"] as const;
// connector は「名前付きの join(縫い合わせ先)」で、check は両パーツが同じ id を宣言しているかだけで
// ペアにする(seam の形の分類ではなく id の一致が本質)。そこで形の taxonomy から選ばせるのをやめ、
// 「プロジェクト内に既にある join から選ぶ」か「新しい join を名付ける」かで縫い合わせ相手を決めさせる。
// 既存から選べば相手と id が確実に一致し(打ち間違いで繋がらない事故を防ぐ)、新規なら将来のパーツが
// 選べる join になる。将来は .val の <path name="seam" seam="..."> から join を供給する余地も残す。

// 「新しい join を名付ける」を表す select の番兵。実在の join id と衝突しないよう説明的な文字列にする。
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

  // 縫い合わせ相手の候補として、プロジェクト内の他パーツが既に宣言している join(connector id)を集める。
  // 取得できなくても add は続行する(最初のパーツや壊れた project では単に候補なしで新規命名に倒す)。
  const existingJoins = await collectExistingJoins(options.cwd);

  const prompter = options.prompter ?? createReadlinePrompter();
  let answers: PartAnswers;

  try {
    answers = await collectAnswers(prompter, options.stdout, defaultName, existingJoins);
  } catch (error) {
    // パイプ/リダイレクト入力が必要な回答数に足りず、default で埋められない prompt(Custom type / New join 名 等)に
    // 達したとき。空回答で問い直し続けてハングするより、ここで綺麗に失敗終了させる。
    if (error instanceof EndOfInputError) {
      options.stderr(
        "入力が途中で終了したため、part を追加できませんでした(必須の回答が不足)。 / Input ended before all required answers were provided.\n" +
          "全ての回答を渡すか、対話端末で実行してください。 / Provide every answer, or run it in an interactive terminal.\n"
      );
      return 1;
    }

    throw error;
  } finally {
    prompter.close();
  }

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

export function formatAddHelp(): string {
  return [
    "Usage: loom add <file.val>",
    "",
    "Add a Valentina .val to the project as a part. Interactively fills in the",
    "metadata that cannot be derived from the .val (name, type, variant, joins),",
    "generates parts/<name>/part.loom, and registers it in loomit.yml.",
    "",
    "Options:",
    "  --help  Show this help."
  ].join("\n") + "\n";
}

async function collectAnswers(
  prompter: Prompter,
  notify: (text: string) => void,
  defaultName: string,
  existingJoins: readonly ExistingJoin[]
): Promise<PartAnswers> {
  const name = await promptSegment(prompter, notify, "Part name", defaultName);
  const type = await promptType(prompter, notify);
  const variant = await prompter.input("Variant", { default: "v1" });
  const connectors = await promptConnectors(prompter, notify, existingJoins);

  return { name, type, variant, connectors };
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
  // 相手になりうる join がまだ無い(最初のパーツ等)なら、選ばせず新しい join を名付けてもらう。
  if (existingJoins.length === 0) {
    return promptSegment(prompter, notify, "New join name", undefined);
  }

  // どの join がどのパーツのものかは select の番号一覧だけでは分からないため、先に宣言元 role 付きで示す。
  notify(
    "Existing joins (pick one to connect, or name a new one):\n" +
      existingJoins.map((join) => `  ${join.id} (${join.roles.join(", ")})`).join("\n") +
      "\n"
  );

  const choices = [...existingJoins.map((join) => join.id), NAME_NEW_JOIN];
  const chosen = await prompter.select("Connect to which join?", choices, {
    default: choices[0] ?? NAME_NEW_JOIN
  });

  if (chosen !== NAME_NEW_JOIN) {
    return chosen;
  }

  return promptSegment(prompter, notify, "New join name", undefined);
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

// 単一 segment を満たすまで訊き直す。core も同じ検証をするが、失敗させる前にここで直せるようにする。
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
    notify("Use a single name without slashes or \"..\".\n");
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
