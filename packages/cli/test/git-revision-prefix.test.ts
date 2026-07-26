import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveProjectPrefix } from "../src/git/gitRevision.js";
import { runCli } from "../src/main.js";

// hermetic な使い捨て repo で git を回す。repo-local config だけを触り、ユーザー環境に触れない。
function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

const LOOMIT_YML = [
  "schema: loomit.project.v0",
  "name: demo",
  "garment: blouse",
  "parts:",
  "  body: ./parts/body/part.loom"
].join("\n");

const PART_V1 = [
  "schema: loomit.part.v0",
  "name: darted-body",
  "variant: front-v1",
  "type: body",
  "darts:",
  "  waist_front:",
  "    apex_ref: val:point#bodice/Apex",
  "    width_mm: 30",
  "    intake_length_mm: 110",
  "    legs:",
  "      left_ref: val:point#bodice/Left",
  "      right_ref: val:point#bodice/Right"
].join("\n");

const PART_V2 = PART_V1.replace("width_mm: 30", "width_mm: 35").replace(
  "intake_length_mm: 110",
  "intake_length_mm: 120"
);

// project を repo 内の subdir に置ける版。subdir が空文字なら repo root 直下。
async function makeRepo(subdir = ""): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "loomit-prefix-"));
  const projectDir = subdir === "" ? repo : join(repo, subdir);

  await mkdir(join(projectDir, "parts/body"), { recursive: true });
  await writeFile(join(projectDir, "loomit.yml"), LOOMIT_YML, "utf8");
  await writeFile(join(projectDir, "parts/body/part.loom"), PART_V1, "utf8");

  git(repo, "init", "-q");
  git(repo, "config", "user.email", "test@loomit.dev");
  git(repo, "config", "user.name", "Loomit Test");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "v1");

  await writeFile(join(projectDir, "parts/body/part.loom"), PART_V2, "utf8");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "v2");

  return repo;
}

describe("resolveProjectPrefix", () => {
  it("returns an empty prefix at the repository root", async () => {
    // 守る仕様: root 直下では prefix は空文字(worktree に join すると worktree そのものになる)。
    const repo = await makeRepo();
    const result = await resolveProjectPrefix(repo);

    expect(result).toEqual({ ok: true, prefix: "" });
  });

  it("returns the POSIX-separated prefix for a project in a subdirectory", async () => {
    // 守る仕様: subdir の位置を git 自身の表記(POSIX 区切り・末尾 /)でそのまま返す。
    const repo = await makeRepo("garments/blouse");
    const result = await resolveProjectPrefix(join(repo, "garments/blouse"));

    expect(result).toEqual({ ok: true, prefix: "garments/blouse/" });
  });

  it("reports a failure outside a repository instead of defaulting to the root", async () => {
    // 守る仕様: 解決できないとき空文字に潰さない。潰すと repo root を project と誤認して黙って別物を diff する。
    const notARepo = await mkdtemp(join(tmpdir(), "loomit-prefix-bare-"));
    const result = await resolveProjectPrefix(notARepo);

    expect(result.ok).toBe(false);
  });
});

describe("loom diff <revision> with a cwd that git spells differently", () => {
  it("still diffs the two revisions when cwd reaches the repo through a symlink", async (ctx) => {
    // 守る仕様(回帰): cwd の表記と git の toplevel の表記が食い違っても、2版を正しく読む。
    // 自前の relative() で位置を引き算していた頃は、食い違うと worktree の外(元の作業ツリー)を指し、
    // **エラーを出さずに「差分なし」**と答えていた。表記が割れる環境は実在する ── Windows CI の
    // 8.3 短縮名 TEMP(`C:\Users\RUNNER~1\...`)、macOS の /var -> /private/var、そしてこの symlink。
    const repo = await makeRepo();
    const link = join(await mkdtemp(join(tmpdir(), "loomit-prefix-link-")), "via-symlink");

    try {
      await symlink(repo, link, "dir");
    } catch {
      // Windows の symlink は特権(開発者モード/管理者)が要る。作れない環境では検証対象を作れないので skip。
      // ubuntu では常に走るため、回帰の見張りは CI 上で維持される。
      ctx.skip();
      return;
    }

    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCli(["node", "loom", "diff", "HEAD~1..HEAD", "--part", "body"], {
      cwd: link,
      io: {
        stdout: (text: string) => stdout.push(text),
        stderr: (text: string) => stderr.push(text)
      }
    });

    expect(stderr).toEqual([]);
    expect(exitCode).toBe(0);
    expect(stdout.join("")).toContain("Loomit diff: changed");
    expect(stdout.join("")).toContain("- width_mm: 30 -> 35");
  });
});
