import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runSeamlintRequestCommand } from "../src/commands/seamlintRequest.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../../core/test/fixtures");

describe("runSeamlintRequestCommand", () => {
  it("builds a JSON Seamlint request for a healthy project", async () => {
    // 守る仕様: 健全な project では ok の JSON request を組み、parts と sewn-seam check を含める。
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runSeamlintRequestCommand(
      [join(fixturesRoot, "valid-blouse"), "--format", "json"],
      {
        cwd: fixturesRoot,
        stdout: (text) => {
          stdout.push(text);
        },
        stderr: (text) => {
          stderr.push(text);
        }
      }
    );

    const report = JSON.parse(stdout.join("")) as {
      readonly status: string;
      readonly diagnostics: readonly unknown[];
      readonly request: {
        readonly parts: readonly { readonly partId: string }[];
        readonly checks: readonly { readonly kind: string; readonly id: string }[];
      };
    };

    expect(exitCode).toBe(0);
    expect(report.status).toBe("ok");
    expect(report.diagnostics).toEqual([]);
    expect(report.request.parts.map((part) => part.partId)).toEqual(["body", "sleeve"]);
    expect(report.request.checks).toEqual([
      expect.objectContaining({
        kind: "sewn-seam",
        id: "sewn-seam:body.armhole/sleeve.armhole"
      })
    ]);
    expect(stderr).toEqual([]);
  });

  it("surfaces warning diagnostics for skipped ease ranges without failing the command", async () => {
    // 守る仕様: range で check を出せない ease は、コマンドを失敗させず warning 診断で surface する(status:warning・parts/checks は空)。
    const tempRoot = await mkdtemp(join(tmpdir(), "loomit-seamlint-request-"));

    try {
      await mkdir(join(tempRoot, "parts/body"), { recursive: true });
      await mkdir(join(tempRoot, "parts/sleeve"), { recursive: true });

      await writeFile(
        join(tempRoot, "loomit.yml"),
        [
          "schema: loomit.project.v0",
          "name: seamlint-request-ease",
          "garment: blouse",
          "parts:",
          "  body: ./parts/body/part.loom",
          "  sleeve: ./parts/sleeve/part.loom"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(tempRoot, "parts/body/part.loom"),
        [
          "schema: loomit.part.v0",
          "name: body",
          "variant: v1",
          "type: body",
          "files:",
          "  preview: body.svg",
          "connectors:",
          "  armhole:",
          "    type: armhole",
          "    path_ref: svg:path#body-armhole",
          "    ranges:",
          "      - id: ease-window",
          "        from: 0.2",
          "        to: 0.7",
          "        behavior: ease"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(tempRoot, "parts/sleeve/part.loom"),
        [
          "schema: loomit.part.v0",
          "name: sleeve",
          "variant: v1",
          "type: sleeve",
          "files:",
          "  preview: sleeve.svg",
          "connectors:",
          "  armhole:",
          "    type: armhole",
          "    path_ref: svg:path#sleeve-armhole",
          "    ranges:",
          "      - id: ease-window",
          "        from: 0.1",
          "        to: 0.6",
          "        behavior: ease"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(tempRoot, "parts/body/body.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><path id="body-armhole" d="M 0 0 L 100 0" /></svg>\n',
        "utf8"
      );
      await writeFile(
        join(tempRoot, "parts/sleeve/sleeve.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><path id="sleeve-armhole" d="M 0 0 L 100 0" /></svg>\n',
        "utf8"
      );

      const stdout: string[] = [];
      const stderr: string[] = [];
      const exitCode = await runSeamlintRequestCommand([tempRoot, "--format", "json"], {
        cwd: fixturesRoot,
        stdout: (text) => {
          stdout.push(text);
        },
        stderr: (text) => {
          stderr.push(text);
        }
      });

      const report = JSON.parse(stdout.join("")) as {
        readonly status: string;
        readonly diagnostics: readonly { readonly code: string }[];
        readonly request: {
          readonly parts: readonly { readonly partId: string }[];
          readonly checks: readonly unknown[];
        };
      };

      expect(exitCode).toBe(0);
      expect(report.status).toBe("warning");
      // ranged connector は check を出せないため、参照されない part path を残さないよう geometry も載せない。
      expect(report.request.parts).toEqual([]);
      expect(report.request.checks).toEqual([]);
      expect(report.diagnostics).toEqual([
        expect.objectContaining({
          code: "SEAMLINT_CONNECTOR_RANGE_EASE_SUBRANGE_UNSUPPORTED"
        }),
        expect.objectContaining({
          code: "SEAMLINT_CONNECTOR_LEFT_UNCHECKED"
        })
      ]);
      expect(stderr).toEqual([]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
