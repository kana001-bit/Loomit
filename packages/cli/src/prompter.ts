import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

// 対話ウィザードが使う最小の入力インターフェース。CLI コマンドはこの Prompter 越しにだけ質問する。
// 本番は readline 実装、テストは回答をキュー注入した scripted 実装を渡すことで、対話フローを
// 決定的にテストできる(既存の stdout/stderr 注入と同じ流儀)。
export interface Prompter {
  // 自由入力。空回答かつ default 指定時は default を返す。
  input(question: string, options?: { readonly default?: string }): Promise<string>;
  // 候補から1つ選ばせる。番号でも値そのものでも受け付け、無効なら再質問する。
  select(
    question: string,
    choices: readonly string[],
    options?: { readonly default?: string }
  ): Promise<string>;
  // yes / no。空回答時は default を返す。
  confirm(question: string, options?: { readonly default?: boolean }): Promise<boolean>;
  // readline など資源を持つ実装のための後始末。
  close(): void;
}

// process.stdin / stdout(または任意の stream)を使う本番 Prompter。
//
// 行は「キュー」で受ける。readline はパイプ入力を一気に読み切って 'line' を先に流すため、質問より先に
// 届いた行を捨てると `loom add < answers.txt` のような非対話入力が壊れる。届いた行を貯め、質問が来たら
// 先頭から渡すことで、TTY(1行ずつ)でもパイプ(一括)でも同じ順序で回答を消費できる。
export function createReadlinePrompter(
  input: Readable = process.stdin,
  output: Writable = process.stdout
): Prompter {
  // prompt は自前で output.write するので、readline には output を渡さない(二重エコー防止)。
  const rl = createInterface({ input });
  const bufferedLines: string[] = [];
  const waiters: Array<(line: string) => void> = [];
  let closed = false;

  rl.on("line", (line) => {
    const waiter = waiters.shift();

    if (waiter === undefined) {
      bufferedLines.push(line);
    } else {
      waiter(line);
    }
  });

  rl.on("close", () => {
    closed = true;
    // EOF 後に待っている質問は空回答で解決し、ハングさせない(default があれば呼び手が拾う)。
    for (const waiter of waiters.splice(0)) {
      waiter("");
    }
  });

  function nextLine(): Promise<string> {
    const buffered = bufferedLines.shift();

    if (buffered !== undefined) {
      return Promise.resolve(buffered);
    }

    if (closed) {
      return Promise.resolve("");
    }

    return new Promise((resolve) => {
      waiters.push(resolve);
    });
  }

  async function ask(prompt: string): Promise<string> {
    output.write(prompt);
    const line = await nextLine();
    return line.trim();
  }

  async function select(
    question: string,
    choices: readonly string[],
    options?: { readonly default?: string }
  ): Promise<string> {
    output.write(`${question}\n`);
    choices.forEach((choice, index) => {
      const marker = choice === options?.default ? " (default)" : "";
      output.write(`  ${index + 1}) ${choice}${marker}\n`);
    });

    const raw = await ask("> ");

    if (raw === "" && options?.default !== undefined) {
      return options.default;
    }

    const byIndex = Number.parseInt(raw, 10);

    if (Number.isInteger(byIndex) && byIndex >= 1 && byIndex <= choices.length) {
      const choice = choices[byIndex - 1];

      if (choice !== undefined) {
        return choice;
      }
    }

    if (choices.includes(raw)) {
      return raw;
    }

    output.write(`Please choose 1-${choices.length}.\n`);
    return select(question, choices, options);
  }

  return {
    async input(question, options) {
      const suffix = options?.default === undefined ? "" : ` [${options.default}]`;
      const answer = await ask(`${question}${suffix}: `);
      return answer === "" && options?.default !== undefined ? options.default : answer;
    },
    select,
    async confirm(question, options) {
      const fallback = options?.default ?? false;
      const hint = fallback ? "[Y/n]" : "[y/N]";
      const raw = (await ask(`${question} ${hint}: `)).toLowerCase();

      if (raw === "") {
        return fallback;
      }

      return raw === "y" || raw === "yes";
    },
    close() {
      rl.close();
    }
  };
}
