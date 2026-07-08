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

// 対話の途中で入力(stdin)が尽きたことを表す。パイプ/リダイレクト入力が必要な回答数に足りず、
// かつ default で埋められない prompt に達したときに投げる。ここで throw することで、回答を得られない
// prompt を空回答で無限に問い直してハングする事故を防ぐ(呼び手は wizard を失敗終了させる)。
export class EndOfInputError extends Error {
  constructor() {
    super("Input ended before a required answer was provided.");
    this.name = "EndOfInputError";
  }
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
  const waiters: Array<{
    readonly resolve: (line: string) => void;
    readonly reject: (error: Error) => void;
  }> = [];
  let closed = false;

  rl.on("line", (line) => {
    const waiter = waiters.shift();

    if (waiter === undefined) {
      bufferedLines.push(line);
    } else {
      waiter.resolve(line);
    }
  });

  rl.on("close", () => {
    closed = true;
    // EOF 後に待っている質問は解決不能。空回答で解決すると default を持たない prompt の retry ループが
    // 永遠に回ってハングするため、EndOfInputError で失敗させる(default を持つ prompt は下の catch で拾う)。
    for (const waiter of waiters.splice(0)) {
      waiter.reject(new EndOfInputError());
    }
  });

  function nextLine(): Promise<string> {
    const buffered = bufferedLines.shift();

    if (buffered !== undefined) {
      return Promise.resolve(buffered);
    }

    if (closed) {
      return Promise.reject(new EndOfInputError());
    }

    return new Promise((resolve, reject) => {
      waiters.push({ resolve, reject });
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

    let raw: string;

    try {
      raw = await ask("> ");
    } catch (error) {
      // EOF。default があればそれを使い、無ければ「入力が尽きた」を呼び手へ伝える(retry ループを回さない)。
      if (error instanceof EndOfInputError && options?.default !== undefined) {
        return options.default;
      }

      throw error;
    }

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

      try {
        const answer = await ask(`${question}${suffix}: `);
        return answer === "" && options?.default !== undefined ? options.default : answer;
      } catch (error) {
        // EOF。default があればそれを使い、無ければ呼び手へ EndOfInputError を伝える(無限問い直しを防ぐ)。
        if (error instanceof EndOfInputError && options?.default !== undefined) {
          return options.default;
        }

        throw error;
      }
    },
    select,
    async confirm(question, options) {
      const fallback = options?.default ?? false;
      const hint = fallback ? "[Y/n]" : "[y/N]";

      try {
        const raw = (await ask(`${question} ${hint}: `)).toLowerCase();

        if (raw === "") {
          return fallback;
        }

        return raw === "y" || raw === "yes";
      } catch (error) {
        // confirm は常に fallback を持つので、EOF なら fallback に落とす(ハングも失敗もさせない)。
        if (error instanceof EndOfInputError) {
          return fallback;
        }

        throw error;
      }
    },
    close() {
      rl.close();
    }
  };
}
