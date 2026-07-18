import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { statSync } from "node:fs";
import { delimiter, extname, isAbsolute, join, resolve } from "node:path";

// 外部ツール(Seamlint / Truer)を subprocess で呼ぶための共通起動ロジック。Windows は cmd.exe の locale 依存・
// OEM 符号化な未検出メッセージに頼れないので、PATH/PATHEXT を自前で辿って実行ファイルを解決し、見つからなければ
// subprocess を起動せず未検出を確定する(posix は shell 無し spawn の ENOENT で拾う)。Seamlint runner と
// Truer runner が同じ解決規則を使うため、ここに一本化する(Windows の .cmd/.exe 分岐を二重に持たない)。

// Windows の shell コマンド文字列に実行ファイルパスや引数を載せる際、cmd.exe のメタ文字(空白/& ( ) ^ < > | 等)で
// 分解されないよう常に二重引用符で囲う。二重引用符内ではこれらは字義通り扱われる。Windows のパスは " を含められない
// ので引用符のエスケープは不要。(% / ! の変数展開だけは引用符内でも残るが、これは cmd.exe 固有の制約で本ケースの対象外。)
// 既に前後を引用済みの入力は二重掛けしない。
export function quoteForCmd(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value;
  }
  return `"${value}"`;
}

// 実行ファイルを解決して子プロセスを起動する。cwd は実行ファイル解決・子プロセスの基準ディレクトリ。
// Windows で実行ファイルを解決できなければ undefined(未検出)。args は固定トークンでもファイルパスでもよく、
// cmd.exe 経由(.cmd/.bat)のときは各 args もメタ文字対策で引用する。
export function spawnResolvedProcess(
  bin: string,
  args: readonly string[],
  cwd: string
): ChildProcessWithoutNullStreams | undefined {
  // posix は shell 無しで PATH 解決でき、未検出は ENOENT の error イベントで確実に拾える。
  if (process.platform !== "win32") {
    return spawn(bin, [...args], { cwd });
  }

  // Windows は .cmd/.exe を CreateProcess で直接叩けないため PATH/PATHEXT を自前解決する。
  const resolved = resolveExecutable(bin, cwd);
  if (resolved === undefined) {
    return undefined;
  }

  // 実 .exe/.com は shell 無しで直接起動でき、パス中のメタ文字に一切影響されない。
  const ext = extname(resolved).toLowerCase();
  if (ext === ".exe" || ext === ".com") {
    return spawn(resolved, [...args], { cwd });
  }

  // .cmd/.bat 等は cmd.exe 経由が要る。実行ファイルパスと各引数を二重引用符で囲みメタ文字での分解を防ぐ。
  // 単一コマンド文字列 + shell:true で渡すので、args 配列 + shell:true の DEP0190 も踏まない。
  const command = [quoteForCmd(resolved), ...args.map((arg) => quoteForCmd(arg))].join(" ");
  return spawn(command, { shell: true, cwd });
}

// PATH / PATHEXT を辿って実行ファイルの実体パスを返す。見つからなければ undefined。cmd.exe の locale 依存・
// OEM 符号化な未検出メッセージに頼らず、未検出を確実に判定するために使う。相対パスの解決とカレントディレクトリ探索は、
// CLI 全体と揃えるため cwd を基準にする(process.cwd() ではない)ため、runCli 埋め込みで cwd を差し替えても
// 他コマンドと挙動が一致する。
export function resolveExecutable(bin: string, cwd: string): string | undefined {
  const isWindows = process.platform === "win32";
  const hasSeparator = bin.includes("/") || (isWindows && bin.includes("\\"));

  const candidates: string[] = [];
  if (isAbsolute(bin) || hasSeparator) {
    // パス指定は PATH 探索せず、cwd 基準で解決する(絶対パスはそのまま)。
    candidates.push(resolve(cwd, bin));
  } else {
    const pathDirs = (process.env.PATH ?? "").split(delimiter).filter((dir) => dir.length > 0);
    // Windows は cmd.exe 同様まずカレントディレクトリ(= cwd)も見る。
    if (isWindows) {
      pathDirs.unshift(cwd);
    }
    for (const dir of pathDirs) {
      candidates.push(join(dir, bin));
    }
  }

  const pathExts = isWindows
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter((ext) => ext.length > 0)
    : [];

  for (const candidate of candidates) {
    // Windows で拡張子が無い名前は、cmd.exe と同様に PATHEXT を補って解決する
    // (拡張子無しの実体は CreateProcess/cmd では起動対象にならないため)。
    if (isWindows && extname(candidate) === "") {
      for (const ext of pathExts) {
        if (isFile(candidate + ext)) {
          return candidate + ext;
        }
      }
      continue;
    }
    if (isFile(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
