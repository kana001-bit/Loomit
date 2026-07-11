import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

// hermetic な使い捨て repo で git を回す。repo-local config だけを触り、ユーザー環境に触れない。
function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function collectOutput() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (text: string) => {
        stdout.push(text);
      },
      stderr: (text: string) => {
        stderr.push(text);
      }
    }
  };
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

// v1 をコミット済み・v2 をコミット済みの repo を作る。HEAD~1 = v1, HEAD = v2。
async function makeRepoWithTwoRevisions(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "loomit-diff-git-"));
  await mkdir(join(repo, "parts/body"), { recursive: true });
  await writeFile(join(repo, "loomit.yml"), LOOMIT_YML, "utf8");
  await writeFile(join(repo, "parts/body/part.loom"), PART_V1, "utf8");

  git(repo, "init", "-q");
  git(repo, "config", "user.email", "test@loomit.dev");
  git(repo, "config", "user.name", "Loomit Test");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "v1");

  await writeFile(join(repo, "parts/body/part.loom"), PART_V2, "utf8");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "v2");

  return repo;
}

describe("loom diff <revision>", () => {
  it("reads a semantic dart change between two revisions (A..B) and cleans up its worktrees", async () => {
    // 守る仕様: loom diff A..B --part <role> は Git 履歴の2版を意味差分として読み、一時 worktree を残さない。
    const repo = await makeRepoWithTwoRevisions();

    try {
      const output = collectOutput();
      const exitCode = await runCli(["node", "loom", "diff", "HEAD~1..HEAD", "--part", "body"], {
        cwd: repo,
        io: output.io
      });

      const stdout = output.stdout.join("");
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Loomit diff: changed");
      expect(stdout).toContain("[modified] dart waist_front");
      expect(stdout).toContain("- width_mm: 30 -> 35");
      expect(stdout).toContain("- intake_length_mm: 110 -> 120");
      expect(output.stderr).toEqual([]);

      // 一時 worktree は必ず後始末する(main worktree の1行だけが残る)。
      const worktrees = execFileSync("git", ["worktree", "list"], { cwd: repo, encoding: "utf8" })
        .trim()
        .split("\n")
        .filter((line) => line.length > 0);
      expect(worktrees).toHaveLength(1);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("diffs a revision against the working tree when given a single ref", async () => {
    // 守る仕様: loom diff <rev> --part <role> は、その版を from・作業ツリー(未コミット含む)を to にする。
    const repo = await makeRepoWithTwoRevisions();

    try {
      // 未コミットで width を 35 -> 40 に変える。HEAD(=35) と作業ツリー(=40)の差が出るはず。
      await writeFile(
        join(repo, "parts/body/part.loom"),
        PART_V2.replace("width_mm: 35", "width_mm: 40"),
        "utf8"
      );

      const output = collectOutput();
      const exitCode = await runCli(["node", "loom", "diff", "HEAD", "--part", "body"], {
        cwd: repo,
        io: output.io
      });

      const stdout = output.stdout.join("");
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Loomit diff: changed");
      expect(stdout).toContain("- width_mm: 35 -> 40");
      expect(output.stderr).toEqual([]);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("supports --format json for a revision diff", async () => {
    const repo = await makeRepoWithTwoRevisions();

    try {
      const output = collectOutput();
      const exitCode = await runCli(
        ["node", "loom", "diff", "HEAD~1..HEAD", "--part", "body", "--format", "json"],
        { cwd: repo, io: output.io }
      );

      const report = JSON.parse(output.stdout.join("")) as { readonly status: string };
      expect(exitCode).toBe(0);
      expect(report.status).toBe("changed");
      expect(output.stderr).toEqual([]);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("returns a usage error (exit 2) when a revision diff is run outside a Git repository", async () => {
    // 守る仕様: git リポジトリ外で revision 差分を求められたら、黙って失敗せず usage エラーで理由を告げる。
    const notARepo = await mkdtemp(join(tmpdir(), "loomit-diff-nogit-"));

    try {
      const output = collectOutput();
      const exitCode = await runCli(["node", "loom", "diff", "HEAD~1..HEAD", "--part", "body"], {
        cwd: notARepo,
        io: output.io
      });

      expect(exitCode).toBe(2);
      expect(output.stderr.join("")).toContain("must run inside a Git repository");
    } finally {
      await rm(notARepo, { recursive: true, force: true });
    }
  });

  it("returns a usage error (exit 2) for an unknown revision", async () => {
    const repo = await makeRepoWithTwoRevisions();

    try {
      const output = collectOutput();
      const exitCode = await runCli(
        ["node", "loom", "diff", "does-not-exist..HEAD", "--part", "body"],
        { cwd: repo, io: output.io }
      );

      expect(exitCode).toBe(2);
      expect(output.stderr.join("")).toContain("Not a Git revision: does-not-exist");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("returns a usage error (exit 2) when a revision diff has no --part", async () => {
    // 守る仕様: revision 差分は project 差分なので、--part 無しは黙って part-file 扱いにせず理由を告げて弾く。
    const repo = await makeRepoWithTwoRevisions();

    try {
      const output = collectOutput();
      const exitCode = await runCli(["node", "loom", "diff", "HEAD~1..HEAD"], {
        cwd: repo,
        io: output.io
      });

      expect(exitCode).toBe(2);
      expect(output.stderr.join("")).toContain("--part");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
