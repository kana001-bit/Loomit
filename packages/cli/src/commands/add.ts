import { basename, dirname, relative, resolve } from "node:path";

import { addPartToProject, checkValSourceExists, isSafePathSegment } from "@loomit/core";
import type { AddedPart, AddPartConnectorInput } from "@loomit/core";
import { formatDiagnosticsText } from "../formatters/diagnosticsText.js";
import { createReadlinePrompter } from "../prompter.js";
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
// seam(縫い合わせ口)の候補。connector.type と record key を兼ねる。
const SEAM_CHOICES = ["armhole", "neckline", "shoulder", "side", "waist", "hem", "other"] as const;

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

  const prompter = options.prompter ?? createReadlinePrompter();
  let answers: PartAnswers;

  try {
    answers = await collectAnswers(prompter, options.stdout, defaultName);
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
    "metadata that cannot be derived from the .val (name, type, variant, seams),",
    "generates parts/<name>/part.loom, and registers it in loomit.yml.",
    "",
    "Options:",
    "  --help  Show this help."
  ].join("\n") + "\n";
}

async function collectAnswers(
  prompter: Prompter,
  notify: (text: string) => void,
  defaultName: string
): Promise<PartAnswers> {
  const name = await promptSegment(prompter, notify, "Part name", defaultName);
  const type = await promptType(prompter, notify);
  const variant = await prompter.input("Variant", { default: "v1" });
  const connectors = await promptConnectors(prompter, notify);

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
  notify: (text: string) => void
): Promise<readonly AddPartConnectorInput[]> {
  const connectors: AddPartConnectorInput[] = [];
  let more = await prompter.confirm("Add a seam connector?", { default: false });

  while (more) {
    const seam = await promptSeam(prompter, notify);

    if (connectors.some((connector) => connector.id === seam)) {
      notify(`Connector "${seam}" is already added; skipping duplicate.\n`);
    } else {
      const lengthMm = await promptNonNegativeNumber(prompter, notify, `${seam} length_mm`);
      connectors.push({ id: seam, lengthMm });
    }

    more = await prompter.confirm("Add another connector?", { default: false });
  }

  return connectors;
}

async function promptSeam(prompter: Prompter, notify: (text: string) => void): Promise<string> {
  const chosen = await prompter.select("Seam type", SEAM_CHOICES, { default: "armhole" });

  if (chosen !== "other") {
    return chosen;
  }

  return promptSegment(prompter, notify, "Custom seam type", undefined);
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

    notify("Use a single name without slashes, spaces, or \"..\".\n");
  }
}

async function promptNonNegativeNumber(
  prompter: Prompter,
  notify: (text: string) => void,
  label: string
): Promise<number> {
  for (;;) {
    const raw = await prompter.input(label);
    const value = Number(raw);

    if (raw !== "" && Number.isFinite(value) && value >= 0) {
      return value;
    }

    notify("Enter a non-negative number in mm (e.g. 469).\n");
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
