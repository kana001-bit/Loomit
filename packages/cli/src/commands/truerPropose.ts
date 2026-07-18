import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  createDiagnostic,
  type Diagnostic,
  type ResolvedProject,
  type SeamlintGeometryCheckRequest,
  type SeamlintGeometryRequestReport
} from "@loomit/core";

import { spawnResolvedProcess } from "./subprocess.js";

// Truer 実行の結果。ok なら exit 0、失敗は理由コード(未検出/spawn失敗/非0終了)。Seamlint runner と違い
// stdout の parse はしない ── Truer は proposal を --out のファイルに書き、loom は exit code だけ見る。
export type TruerRunResult =
  | { readonly ok: true; readonly exitCode: number }
  | { readonly ok: false; readonly code: string; readonly message: string };

// Truer を実際に走らせる境界。既定は subprocess アダプタだが、テストは fake を注入して実 Truer 無しで
// spawn 引数・整形・分岐を検証する。
export interface TruerRunner {
  run(args: readonly string[]): Promise<TruerRunResult>;
}

// loom match --reference が Truer を呼んだ顛末。proposed=proposal を書けた / skipped=呼べる状態でなかった
// (follower に DXF が無い等) / unavailable=呼べなかった(未検出・失敗)。
export type TruerProposeOutcome =
  | { readonly kind: "proposed"; readonly proposalPath: string }
  | { readonly kind: "skipped"; readonly reason: string }
  | { readonly kind: "unavailable"; readonly code: string; readonly message: string };

export interface TruerProposeResult {
  readonly outcome: TruerProposeOutcome;
  readonly diagnostics: readonly Diagnostic[];
}

export interface RunTruerProposeInput {
  readonly resolvedProject: ResolvedProject;
  // pair-scoped request。reference の BLOCK 名(Seamlint に渡した path_ref)を引くのに使う。
  readonly request: SeamlintGeometryCheckRequest;
  // Seamlint が返した測定済み report。Truer の --diagnostic 入力になる。
  readonly report: SeamlintGeometryRequestReport;
  // 固定辺とみなす側(人が --reference で指定した role)。
  readonly referenceRole: string;
  // 補正される側(reference でない方の role)。Truer が DXF を書き換える対象。
  readonly followerRole: string;
  readonly roleA: string;
  readonly roleB: string;
  readonly cwd: string;
  readonly bin: string;
  readonly runner?: TruerRunner;
}

export function resolveTruerBin(flagValue: string | undefined): string {
  return flagValue ?? process.env.LOOMIT_TRU ?? "tru";
}

// Truer を subprocess で呼ぶアダプタ。`tru propose <dxf> --diagnostic <report> --reference <BLOCK> --out <path>` を
// 起動し、exit code だけ見る(proposal は --out のファイルに書かれる)。未検出や非0終了は理由コード付きで返す。
export function createSubprocessTruerRunner(options: {
  readonly bin: string;
  readonly cwd?: string;
}): TruerRunner {
  const cwd = options.cwd ?? process.cwd();
  return {
    run(args: readonly string[]): Promise<TruerRunResult> {
      return new Promise<TruerRunResult>((resolvePromise) => {
        const child = spawnResolvedProcess(options.bin, args, cwd);
        if (child === undefined) {
          resolvePromise({
            ok: false,
            code: "TRUER_NOT_FOUND",
            message: `Could not find Truer executable "${options.bin}".`
          });
          return;
        }

        let stderr = "";
        let settled = false;
        const settle = (result: TruerRunResult): void => {
          if (!settled) {
            settled = true;
            resolvePromise(result);
          }
        };

        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
        });

        child.on("error", (error: NodeJS.ErrnoException) => {
          settle({
            ok: false,
            code: error.code === "ENOENT" ? "TRUER_NOT_FOUND" : "TRUER_SPAWN_FAILED",
            message: error.message
          });
        });

        child.on("close", (exitCode) => {
          if ((exitCode ?? 1) === 0) {
            settle({ ok: true, exitCode: exitCode ?? 0 });
            return;
          }
          settle({
            ok: false,
            code: "TRUER_FAILED",
            message: `Truer exited ${exitCode ?? "null"}.${stderr.trim() ? ` ${stderr.trim()}` : ""}`
          });
        });

        // Truer は file を読むので stdin は使わない。相手が読まないので EPIPE も無視して閉じる。
        child.stdin.on("error", () => {});
        child.stdin.end();
      });
    }
  };
}

// 測定済み report を Truer に渡して proposal を書かせる。follower(補正側)の DXF・reference の BLOCK 名・
// 出力先を組み立て、report を一時ファイルに書いて `tru propose` を spawn する。DXF が無い等で呼べないときは
// 理由を返して spawn しない(measurement は既に済んでいるので、その報告は呼び出し側が担う)。
export async function runTruerPropose(input: RunTruerProposeInput): Promise<TruerProposeResult> {
  const diagnostics: Diagnostic[] = [];

  // Truer は DXF(follower の files.geometry)を書き換える。SVG しか無い pair は Truer では扱えない。
  const followerPart = input.resolvedProject.parts[input.followerRole];
  const followerGeometry = followerPart?.part.files?.geometry;
  if (followerPart === undefined || followerGeometry === undefined) {
    diagnostics.push(
      createDiagnostic({
        severity: "warning",
        code: "MATCH_REFERENCE_NEEDS_DXF",
        message: `補正側 "${input.followerRole}" に files.geometry(DXF)が無いため、Truer に直し方を提案させられません。 / Part "${input.followerRole}" has no files.geometry (DXF), so Truer cannot propose an adjustment.`,
        target: input.followerRole,
        suggestion: [
          `"${input.followerRole}" に files.geometry(DXF)を足してください。Truer は DXF の辺を補正します。 / Add files.geometry (DXF) for "${input.followerRole}"; Truer edits DXF edges.`
        ]
      })
    );
    return { outcome: { kind: "skipped", reason: "follower part has no DXF geometry" }, diagnostics };
  }

  const followerDxf = resolve(dirname(followerPart.filePath), followerGeometry);
  if (!existsSync(followerDxf)) {
    diagnostics.push(
      createDiagnostic({
        severity: "warning",
        code: "MATCH_REFERENCE_NEEDS_DXF",
        message: `補正側 "${input.followerRole}" の files.geometry が指す DXF が見つかりません。 / The DXF referenced by files.geometry for "${input.followerRole}" does not exist.`,
        target: followerDxf,
        suggestion: [`欠けている DXF を置くか、files.geometry を実在するパスに直してください。 / Add the DXF, or fix files.geometry.`]
      })
    );
    return { outcome: { kind: "skipped", reason: "follower DXF file is missing" }, diagnostics };
  }

  // reference の BLOCK 名。Seamlint に渡した path_ref(request の part.paths の値・pathRef=BLOCK 名)を使う。
  // Truer は report の from/to edge の blockName と --reference を照合するので、report と同じ値を渡す。
  const referenceBlock = referenceBlockName(input.request, input.referenceRole);
  if (referenceBlock === undefined) {
    diagnostics.push(
      createDiagnostic({
        severity: "warning",
        code: "MATCH_REFERENCE_BLOCK_UNRESOLVED",
        message: `固定側 "${input.referenceRole}" の BLOCK 名を解決できませんでした。 / Could not resolve the DXF BLOCK name for reference part "${input.referenceRole}".`,
        target: input.referenceRole,
        suggestion: [`"${input.referenceRole}" の files.piece(DXF BLOCK 名)か connector.path_ref を設定してください。 / Set files.piece or connector.path_ref for "${input.referenceRole}".`]
      })
    );
    return { outcome: { kind: "skipped", reason: "reference block name unresolved" }, diagnostics };
  }

  // proposal の出力先は loom-managed の output 配下 output/match/<a>-<b>.proposal.json。loom が dir を作ってから
  // Truer に絶対 --out を渡す(Truer は path を発明しない)。
  const projectRoot = input.resolvedProject.paths.projectRoot;
  const outputDir = resolve(projectRoot, input.resolvedProject.project.outputs?.dir ?? "./output");
  const proposalDir = join(outputDir, "match");
  const proposalPath = join(proposalDir, `${input.roleA}-${input.roleB}.proposal.json`);

  try {
    await mkdir(proposalDir, { recursive: true });
  } catch (error) {
    diagnostics.push(
      createDiagnostic({
        severity: "warning",
        code: "MATCH_PROPOSAL_DIR_FAILED",
        message: `proposal の出力先ディレクトリを作成できませんでした: ${describeError(error)} / Could not create the proposal output directory.`,
        target: proposalDir,
        suggestion: ["出力ディレクトリの権限を確認してください。 / Check permissions for the output directory."]
      })
    );
    return { outcome: { kind: "skipped", reason: "could not create proposal directory" }, diagnostics };
  }

  // Truer は --diagnostic をファイルで受け取る。測定済み report を一時ファイルに書いて渡し、後で消す
  // (report は中間物なので output/match には残さない)。
  const reportDir = await mkdtemp(join(tmpdir(), "loomit-match-report-"));
  const reportFile = join(reportDir, "report.json");
  try {
    await writeFile(reportFile, JSON.stringify(input.report), "utf8");

    const runner = input.runner ?? createSubprocessTruerRunner({ bin: input.bin, cwd: input.cwd });
    const runResult = await runner.run([
      "propose",
      followerDxf,
      "--diagnostic",
      reportFile,
      "--reference",
      referenceBlock,
      "--out",
      proposalPath
    ]);

    if (!runResult.ok) {
      const notFound = runResult.code === "TRUER_NOT_FOUND";
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: runResult.code,
          message: notFound
            ? `Truer 実行ファイルが見つからず、直し方を提案できませんでした (${runResult.message})。 / Loomit could not find the Truer executable (${runResult.message}).`
            : `Truer を実行できませんでした: ${runResult.message} / Loomit could not run Truer: ${runResult.message}`,
          target: "truer",
          suggestion: notFound
            ? ['"tru" を PATH に置くか、--tru <path> で実行ファイルを指定してください。 / Install Truer on PATH, or pass --tru <path>.']
            : ['Truer が "tru propose" を受け付けて動くか確認してください。 / Check that Truer runs and accepts "tru propose".']
        })
      );
      return {
        outcome: { kind: "unavailable", code: runResult.code, message: runResult.message },
        diagnostics
      };
    }

    return { outcome: { kind: "proposed", proposalPath }, diagnostics };
  } finally {
    await rm(reportDir, { recursive: true, force: true });
  }
}

// reference part の BLOCK 名を pair-scoped request から引く。part.paths は connectorId→pathRef(=BLOCK 名)で、
// 1ピース=1 BLOCK なので値はどれも同じ。最初の値を採る。part が request に無い/paths が空なら undefined。
function referenceBlockName(
  request: SeamlintGeometryCheckRequest,
  referenceRole: string
): string | undefined {
  const part = request.parts.find((candidate) => candidate.partId === referenceRole);
  if (part === undefined) {
    return undefined;
  }
  const [firstBlock] = Object.values(part.paths);
  return firstBlock;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
