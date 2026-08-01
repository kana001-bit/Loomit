import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  collectProjectReadinessDiagnostics,
  isCaseInsensitiveFileSystemAt,
  loadProject,
  resolveParts
} from "../../src/index.js";

async function resolve(projectRoot: string) {
  const loaded = await loadProject(projectRoot);

  if (!loaded.ok) {
    throw new Error("Expected project to load.");
  }

  const resolved = await resolveParts(loaded.value);

  if (!resolved.ok) {
    throw new Error("Expected project parts to resolve.");
  }

  return resolved.value;
}

async function writeProject(projectRoot: string, partsBlock: string): Promise<void> {
  await writeFile(
    join(projectRoot, "loomit.yml"),
    ["schema: loomit.project.v0", "name: readiness-blouse", "garment: blouse", partsBlock].join(
      "\n"
    ),
    "utf8"
  );
}

async function writeBodyPart(projectRoot: string): Promise<void> {
  await mkdir(join(projectRoot, "parts/body"), { recursive: true });
  await writeFile(
    join(projectRoot, "parts/body/part.loom"),
    [
      "schema: loomit.part.v0",
      "name: body",
      "variant: v1",
      "type: body",
      "files:",
      "  source: body.val"
    ].join("\n"),
    "utf8"
  );
  await writeFile(join(projectRoot, "parts/body/body.val"), "body source\n", "utf8");
}

describe("collectProjectReadinessDiagnostics", () => {
  it("errors when the project has no parts at all", async () => {
    // 守る仕様: parts が空の project は PROJECT_HAS_NO_PARTS を error で出す。
    const projectRoot = await mkdtemp(join(tmpdir(), "loomit-readiness-empty-"));

    try {
      await writeProject(projectRoot, "parts: {}");

      const diagnostics = await collectProjectReadinessDiagnostics(await resolve(projectRoot));

      expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["PROJECT_HAS_NO_PARTS"]);
      expect(diagnostics[0]?.severity).toBe("error");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("warns about a .val under parts/ that no part references", async () => {
    // 守る仕様: どの part も参照しない parts/ 下の .val は UNREGISTERED_VAL_SOURCE を warning で出し、loom add を促す。
    const projectRoot = await mkdtemp(join(tmpdir(), "loomit-readiness-stray-"));

    try {
      await writeProject(projectRoot, "parts:\n  body: ./parts/body/part.loom");
      await writeBodyPart(projectRoot);
      // 登録されていない .val。
      await writeFile(join(projectRoot, "parts/leftover.val"), "stray\n", "utf8");

      const diagnostics = await collectProjectReadinessDiagnostics(await resolve(projectRoot));

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.code).toBe("UNREGISTERED_VAL_SOURCE");
      expect(diagnostics[0]?.severity).toBe("warning");
      expect(diagnostics[0]?.suggestion?.[0]).toContain("loom add parts/leftover.val");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("suggests deleting a stray .val that duplicates an already-registered part", async () => {
    // 守る仕様: 登録済み part と同一内容の残骸 .val は、loom add ではなく登録済み source を指した削除を促す。
    const projectRoot = await mkdtemp(join(tmpdir(), "loomit-readiness-dup-"));

    try {
      await writeProject(projectRoot, "parts:\n  body: ./parts/body/part.loom");
      await writeBodyPart(projectRoot);
      // 登録済み parts/body/body.val と同一内容の残骸を parts/ 直下に置く(= コピーの取り残し)。
      await writeFile(join(projectRoot, "parts/body.val"), "body source\n", "utf8");

      const diagnostics = await collectProjectReadinessDiagnostics(await resolve(projectRoot));

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.code).toBe("UNREGISTERED_VAL_SOURCE");

      // 複製なので loom add ではなく「登録済み source を指して削除を促す」に切り替わる。
      const suggestion = diagnostics[0]?.suggestion?.[0] ?? "";
      expect(suggestion).toContain("delete");
      expect(suggestion).toContain("parts/body/body.val");
      expect(suggestion).not.toContain("loom add");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("surfaces a scan failure instead of pretending the project has no unregistered .val", async () => {
    // 守る仕様: 走査の失敗(ENOENT 以外。ここでは parts がファイル)は握り潰して「未登録なし」に
    // 見せかけず、errno 分類済みの VAL_SOURCE_SCAN_FAILED を診断に出す(判定できる parts 空 error は併記)。
    const projectRoot = await mkdtemp(join(tmpdir(), "loomit-readiness-scanfail-"));

    try {
      await writeProject(projectRoot, "parts: {}");
      // parts をディレクトリでなくファイルにして readdir を失敗させる(移植可能な失敗注入)。
      await writeFile(join(projectRoot, "parts"), "not a directory\n", "utf8");

      const diagnostics = await collectProjectReadinessDiagnostics(await resolve(projectRoot));

      expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        "VAL_SOURCE_SCAN_FAILED",
        "PROJECT_HAS_NO_PARTS"
      ]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("is silent when every .val under parts/ is registered", async () => {
    // 守る仕様: parts/ 下の .val が全て登録済みなら診断を出さない。
    const projectRoot = await mkdtemp(join(tmpdir(), "loomit-readiness-ok-"));

    try {
      await writeProject(projectRoot, "parts:\n  body: ./parts/body/part.loom");
      await writeBodyPart(projectRoot);

      const diagnostics = await collectProjectReadinessDiagnostics(await resolve(projectRoot));

      expect(diagnostics).toEqual([]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("warns when a part's copied .val no longer matches the project root original", async () => {
    // 守る仕様: part 内のコピーが root の同名原本と食い違うとき PART_FILE_COPY_STALE を warning で出し、
    // 「root 側が読まれるのでこの part コピーは使われない」ことを message で伝える(コピーを編集しても
    // 効かない、という空振りに気付けるようにする)。
    const projectRoot = await mkdtemp(join(tmpdir(), "loomit-readiness-stale-"));

    try {
      await writeProject(projectRoot, "parts:\n  body: ./parts/body/part.loom");
      await writeBodyPart(projectRoot);
      // writeBodyPart のコピーは "body source\n"。root の原本だけを編集した状態にする。
      await writeFile(join(projectRoot, "body.val"), "edited in Valentina\n", "utf8");

      const diagnostics = await collectProjectReadinessDiagnostics(await resolve(projectRoot));

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.code).toBe("PART_FILE_COPY_STALE");
      expect(diagnostics[0]?.severity).toBe("warning");
      // 「読まれない」ことが message に出ている(「古いものを読む」ではない)。
      expect(diagnostics[0]?.message).toContain("この part コピーは使われません");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("stays silent when the copied .val still matches the project root original", async () => {
    // 守る仕様: 内容が一致していれば root に同名ファイルが在っても警告しない(コピー配置は正常な状態で、
    // 同名の存在だけで PART_FILE_COPY_STALE を出してはならない)。
    const projectRoot = await mkdtemp(join(tmpdir(), "loomit-readiness-fresh-"));

    try {
      await writeProject(projectRoot, "parts:\n  body: ./parts/body/part.loom");
      await writeBodyPart(projectRoot);
      // writeBodyPart が書くコピーと同一内容の原本を root に置く。
      await writeFile(join(projectRoot, "body.val"), "body source\n", "utf8");

      const diagnostics = await collectProjectReadinessDiagnostics(await resolve(projectRoot));

      expect(diagnostics).toEqual([]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  // `.val` と DXF は別ファイルで、書き出しは Valentina 側の手作業。編集したのに書き出し直していない状態は
  // 失敗として表に出ず、loom slnt check が古い幾何を測って古い数値を返す(実際に踏んだ)。
  describe("stale geometry export", () => {
    const hourMs = 60 * 60 * 1000;

    // .val / DXF の対に、geometry を source より指定ミリ秒だけ古い mtime で固定する。
    // 実時間に依存させない(テストの実行速度で結果が変わらないように)。
    async function setGeometryAge(
      projectRoot: string,
      names: { readonly source: string; readonly geometry: string },
      geometryOlderByMs: number
    ): Promise<void> {
      const sourceModified = new Date("2026-08-01T00:00:00Z");
      const geometryModified = new Date(sourceModified.getTime() - geometryOlderByMs);

      await utimes(join(projectRoot, names.source), sourceModified, sourceModified);
      await utimes(join(projectRoot, names.geometry), geometryModified, geometryModified);
    }

    async function writeGeometryPartFile(
      projectRoot: string,
      role: string,
      names: { readonly source: string; readonly geometry: string }
    ): Promise<void> {
      await mkdir(join(projectRoot, "parts", role), { recursive: true });
      await writeFile(
        join(projectRoot, "parts", role, "part.loom"),
        [
          "schema: loomit.part.v0",
          `name: ${role}`,
          "variant: v1",
          "type: body",
          "files:",
          `  source: ${names.source}`,
          `  geometry: ${names.geometry}`
        ].join("\n"),
        "utf8"
      );
    }

    // .val と DXF を持つ part を1つ書き、両者の mtime を指定した差で固定する。
    async function writeGeometryPart(
      projectRoot: string,
      options: { readonly geometryOlderByMs: number }
    ): Promise<void> {
      const names = { source: "body.val", geometry: "body.dxf" };

      await writeProject(projectRoot, "parts:\n  body: ./parts/body/part.loom");
      await writeGeometryPartFile(projectRoot, "body", names);
      await writeFile(join(projectRoot, names.source), "drafting\n", "utf8");
      await writeFile(join(projectRoot, names.geometry), "geometry\n", "utf8");
      await setGeometryAge(projectRoot, names, options.geometryOlderByMs);
    }

    it("warns when the DXF is older than the .val it is exported from", async () => {
      // 守る仕様(should-fire): 書き出し直していない DXF を黙って測らせない。断定はせず、書き出し直す/意図的なら
      //           無視してよい、の両方を suggestion で案内する。
      const projectRoot = await mkdtemp(join(tmpdir(), "loomit-readiness-geometry-"));

      try {
        await writeGeometryPart(projectRoot, { geometryOlderByMs: 72 * hourMs });

        const diagnostics = await collectProjectReadinessDiagnostics(await resolve(projectRoot));

        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]?.code).toBe("PART_GEOMETRY_STALE");
        expect(diagnostics[0]?.severity).toBe("warning");
        expect(diagnostics[0]?.message).toContain("3 days");
        // 断定しない: 幾何が動かない編集もあるので、無視してよい読みも渡す。
        expect(diagnostics[0]?.suggestion?.join(" ")).toContain("can be ignored");
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    });

    it("stays silent when the DXF is newer than the .val", async () => {
      // 守る仕様(must-not-fire): 書き出し直した直後(DXF のほうが新しい)は正常系。
      const projectRoot = await mkdtemp(join(tmpdir(), "loomit-readiness-fresh-geometry-"));

      try {
        await writeGeometryPart(projectRoot, { geometryOlderByMs: -hourMs });

        const diagnostics = await collectProjectReadinessDiagnostics(await resolve(projectRoot));

        expect(diagnostics).toEqual([]);
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    });

    it("stays silent when both files were written at about the same time", async () => {
      // 守る仕様(must-not-fire): git clone / checkout は全ファイルの mtime を操作時刻にし、書き込み順は
      //           保証されない。秒未満の前後で「編集したのに書き出していない」と言わない(取り込み直後の
      //           プロジェクトで毎回警告が出るのを防ぐ)。FAT/exFAT の 2 秒粒度も同じ幅で吸収する。
      const projectRoot = await mkdtemp(join(tmpdir(), "loomit-readiness-clone-"));

      try {
        await writeGeometryPart(projectRoot, { geometryOlderByMs: 800 });

        const diagnostics = await collectProjectReadinessDiagnostics(await resolve(projectRoot));

        expect(diagnostics).toEqual([]);
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    });

    it("warns when the .val was edited seconds after the export", async () => {
      // 守る仕様(should-fire): 「書き出した直後に製図を直す」は普通の操作で、これを見逃すと古い幾何が
      //           黙って測られる ── この検出が潰そうとしている失敗そのもの。猶予は一括書き込みの
      //           ばらつきを吸収する幅までに留め、人の編集の時間スケールまで広げない。
      const projectRoot = await mkdtemp(join(tmpdir(), "loomit-readiness-quick-edit-"));

      try {
        await writeGeometryPart(projectRoot, { geometryOlderByMs: 30_000 });

        const diagnostics = await collectProjectReadinessDiagnostics(await resolve(projectRoot));

        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]?.code).toBe("PART_GEOMETRY_STALE");
        // 分未満でも意味のある文面にする(「0 minutes 古い」と言わない)。
        expect(diagnostics[0]?.message).toContain("30 seconds");
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    });

    it("folds a file referenced with different casing according to the filesystem", async () => {
      // 守る仕様: dedupe は実 FS の case 感度に従う。
      //   - case-insensitive(Windows / macOS 既定): body.dxf と BODY.DXF は**同じ実体**なので、綴り違いで
      //     別 part が参照していても契約どおり1件に畳む(正規化が無いと2件出る)。
      //   - case-sensitive(Linux): **別ファイル**なので畳まない。小文字化を固定すると別ファイルの片方を
      //     握りつぶすことになる。
      // 両環境で意味のあるテストにするため、大文字側の実体も作る ── 作らないと Linux では ENOENT で比較が
      // skip され、「畳まれた」のか「そもそも見ていない」のかを区別できない(CI は ubuntu でも走る)。
      const projectRoot = await mkdtemp(join(tmpdir(), "loomit-readiness-casing-"));
      const lower = { source: "body.val", geometry: "body.dxf" };
      const upper = { source: "BODY.VAL", geometry: "BODY.DXF" };

      try {
        await writeProject(
          projectRoot,
          "parts:\n  body: ./parts/body/part.loom\n  sleeve: ./parts/sleeve/part.loom"
        );
        await writeGeometryPartFile(projectRoot, "body", lower);
        await writeGeometryPartFile(projectRoot, "sleeve", upper);

        // 実体を先に全部作る。case-insensitive では大文字側の write が同じファイルを上書きして mtime を
        // 現在時刻に戻すので、mtime の固定は書き込みを終えてから行う。
        for (const names of [lower, upper]) {
          await writeFile(join(projectRoot, names.source), "drafting\n", "utf8");
          await writeFile(join(projectRoot, names.geometry), "geometry\n", "utf8");
        }

        for (const names of [lower, upper]) {
          await setGeometryAge(projectRoot, names, 72 * hourMs);
        }

        const diagnostics = await collectProjectReadinessDiagnostics(await resolve(projectRoot));
        const stale = diagnostics.filter((diagnostic) => diagnostic.code === "PART_GEOMETRY_STALE");
        const caseInsensitive = await isCaseInsensitiveFileSystemAt(join(projectRoot, "loomit.yml"));

        expect(stale).toHaveLength(caseInsensitive ? 1 : 2);
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    });

    it("reports one diagnostic per file pair, not per part", async () => {
      // 守る仕様: 実データでは複数 part が同じ .val と同じ DXF を共有する(loomitest4 は 3 part が同じ DXF)。
      //           同じ事実を part の数だけ並べない。
      const projectRoot = await mkdtemp(join(tmpdir(), "loomit-readiness-shared-geometry-"));

      try {
        await writeGeometryPart(projectRoot, { geometryOlderByMs: 72 * hourMs });
        await writeProject(
          projectRoot,
          "parts:\n  body: ./parts/body/part.loom\n  sleeve: ./parts/sleeve/part.loom"
        );
        // 綴りまで同じ参照なので、FS の case 感度に関係なく同一の対になる。
        await writeGeometryPartFile(projectRoot, "sleeve", {
          source: "body.val",
          geometry: "body.dxf"
        });

        const diagnostics = await collectProjectReadinessDiagnostics(await resolve(projectRoot));

        expect(diagnostics.filter((diagnostic) => diagnostic.code === "PART_GEOMETRY_STALE")).toHaveLength(1);
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    });

    it("stays silent when the part declares no geometry", async () => {
      // 守る仕様(must-not-fire): files.geometry が無い part は比較対象にならない(DXF 未配線は正常系)。
      const projectRoot = await mkdtemp(join(tmpdir(), "loomit-readiness-no-geometry-"));

      try {
        await writeProject(projectRoot, "parts:\n  body: ./parts/body/part.loom");
        await writeBodyPart(projectRoot);
        await writeFile(join(projectRoot, "body.val"), "body source\n", "utf8");

        const diagnostics = await collectProjectReadinessDiagnostics(await resolve(projectRoot));

        expect(diagnostics).toEqual([]);
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    });
  });
});
