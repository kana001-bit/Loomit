import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { materializeSeamlintGeometry } from "../../src/index.js";
import type { SeamlintGeometryCheckRequest } from "../../src/index.js";

describe("materializeSeamlintGeometry", () => {
  it("inlines each part's geometry source text into the request", async () => {
    const dir = await mkdtemp(join(tmpdir(), "loomit-materialize-"));

    try {
      const bodyPath = join(dir, "body.svg");
      const sleevePath = join(dir, "sleeve.svg");
      await writeFile(bodyPath, "<svg>body</svg>", "utf8");
      await writeFile(sleevePath, "<svg>sleeve</svg>", "utf8");

      const request: SeamlintGeometryCheckRequest = {
        parts: [
          { partId: "body", geometrySource: bodyPath, format: "svg", unit: "mm", scale: 1, paths: { armhole: "body-armhole" } },
          { partId: "sleeve", geometrySource: sleevePath, format: "svg", unit: "mm", scale: 1, paths: { armhole: "sleeve-armhole" } }
        ],
        checks: []
      };

      const result = await materializeSeamlintGeometry(request);

      expect(result.diagnostics).toEqual([]);
      expect(result.request.parts.map((part) => part.geometryText)).toEqual([
        "<svg>body</svg>",
        "<svg>sleeve</svg>"
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("warns and leaves geometryText unset when a source cannot be read", async () => {
    const request: SeamlintGeometryCheckRequest = {
      parts: [
        {
          partId: "body",
          geometrySource: join(tmpdir(), "loomit-missing-source-should-not-exist.svg"),
          format: "svg",
          unit: "mm",
          scale: 1,
          paths: {}
        }
      ],
      checks: []
    };

    const result = await materializeSeamlintGeometry(request);

    expect(result.request.parts[0]?.geometryText).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe("SEAMLINT_GEOMETRY_SOURCE_UNREADABLE");
  });
});
