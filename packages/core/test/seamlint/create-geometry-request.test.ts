import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  createSeamlintGeometryRequest,
  loadProject,
  resolveParts
} from "../../src/index.js";
import type { ResolvedProject } from "../../src/index.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

describe("createSeamlintGeometryRequest", () => {
  it("autodiscovers a healthy two-part seam as a sewn-seam request", async () => {
    // 守る仕様: Seamlint handoff は connector.path_ref の transport prefix を落として、実ファイルがある seam path id を渡す。
    const resolvedProject = await loadResolvedFixture("valid-blouse");

    const result = createSeamlintGeometryRequest(resolvedProject);

    expect(result.diagnostics).toEqual([]);
    expect(result.request).toEqual({
      projectRoot: join(fixturesRoot, "valid-blouse"),
      parts: [
        {
          partId: "body",
          geometrySource: join(fixturesRoot, "valid-blouse/parts/body/body.svg"),
          format: "svg",
          unit: "mm",
          scale: 1,
          paths: {
            armhole: "body-armhole"
          }
        },
        {
          partId: "sleeve",
          geometrySource: join(fixturesRoot, "valid-blouse/parts/sleeve/sleeve.svg"),
          format: "svg",
          unit: "mm",
          scale: 1,
          paths: {
            armhole: "sleeve-armhole"
          }
        }
      ],
      checks: [
        {
          id: "sewn-seam:body.armhole/sleeve.armhole",
          kind: "sewn-seam",
          from: {
            partId: "body",
            pathRef: "armhole",
            connectorId: "armhole"
          },
          to: {
            partId: "sleeve",
            pathRef: "armhole",
            connectorId: "armhole"
          },
          tolerance: {
            length_mm: 3
          }
        }
      ]
    });
  });

  it("prefers files.geometry (DXF) over files.preview and tags the part format as dxf", async () => {
    // 守る仕様: files.geometry が実在するときは preview ではなく geometry を handoff source に使う。
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const body = resolvedProject.parts.body;
    const sleeve = resolvedProject.parts.sleeve;

    if (body === undefined || sleeve === undefined) {
      throw new Error("Expected valid-blouse to resolve body and sleeve parts.");
    }

    const withDxfGeometry: ResolvedProject = {
      ...resolvedProject,
      parts: {
        ...resolvedProject.parts,
        body: {
          ...body,
          part: {
            ...body.part,
            files: { ...body.part.files, geometry: "body.dxf" }
          }
        },
        sleeve: {
          ...sleeve,
          part: {
            ...sleeve.part,
            files: { ...sleeve.part.files, geometry: "sleeve.dxf" }
          }
        }
      }
    };

    const result = createSeamlintGeometryRequest(withDxfGeometry);

    expect(result.diagnostics).toEqual([]);
    expect(result.request.parts).toEqual([
      {
        partId: "body",
        geometrySource: join(fixturesRoot, "valid-blouse/parts/body/body.dxf"),
        format: "dxf",
        unit: "mm",
        scale: 1,
        paths: {
          armhole: "body-armhole"
        }
      },
      {
        partId: "sleeve",
        geometrySource: join(fixturesRoot, "valid-blouse/parts/sleeve/sleeve.dxf"),
        format: "dxf",
        unit: "mm",
        scale: 1,
        paths: {
          armhole: "sleeve-armhole"
        }
      }
    ]);
  });

  it("warns and skips connectors that still lack path_ref or preview geometry", async () => {
    // 守る仕様: connector.path_ref 欠落と files.geometry/files.preview エントリ欠落は別々の warning として surface する。
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const body = resolvedProject.parts.body;
    const sleeve = resolvedProject.parts.sleeve;

    if (body === undefined || sleeve === undefined) {
      throw new Error("Expected valid-blouse to resolve body and sleeve parts.");
    }

    const bodyArmhole = body.part.connectors?.armhole;

    if (bodyArmhole === undefined) {
      throw new Error("Expected body armhole connector.");
    }

    const withoutGeometry: ResolvedProject = {
      ...resolvedProject,
      parts: {
        ...resolvedProject.parts,
        body: {
          ...body,
          part: {
            ...body.part,
            connectors: {
              armhole: {
                type: bodyArmhole.type,
                length_mm: bodyArmhole.length_mm,
                tolerance_mm: bodyArmhole.tolerance_mm
              }
            }
          }
        },
        sleeve: {
          ...sleeve,
          part: {
            ...sleeve.part,
            files: omitPreview(sleeve.part.files)
          }
        }
      }
    };

    const result = createSeamlintGeometryRequest(withoutGeometry);

    expect(result.request.checks).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "SEAMLINT_CONNECTOR_PATH_REF_MISSING",
        target: "body.armhole"
      }),
      expect.objectContaining({
        severity: "warning",
        code: "SEAMLINT_GEOMETRY_SOURCE_MISSING",
        target: join(fixturesRoot, "valid-blouse/parts/sleeve/part.loom")
      })
    ]);
  });

  it("warns and skips a seam when the chosen geometry file path does not exist", async () => {
    // 守る仕様: files.preview/files.geometry が書かれていても、実ファイルが無ければ Seamlint handoff を組み立てない。
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const body = resolvedProject.parts.body;

    if (body === undefined) {
      throw new Error("Expected valid-blouse to resolve the body part.");
    }

    const withMissingPreviewFile: ResolvedProject = {
      ...resolvedProject,
      parts: {
        ...resolvedProject.parts,
        body: {
          ...body,
          part: {
            ...body.part,
            files: { ...body.part.files, preview: "missing-body.svg" }
          }
        }
      }
    };

    const result = createSeamlintGeometryRequest(withMissingPreviewFile);

    expect(result.request.parts).toEqual([]);
    expect(result.request.checks).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        code: "SEAMLINT_GEOMETRY_SOURCE_FILE_MISSING",
        target: join(fixturesRoot, "valid-blouse/parts/body/missing-body.svg")
      })
    );
  });

  it("does not emit a gathered-seam check while the gather direction is unresolved", async () => {
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const body = resolvedProject.parts.body;
    const sleeve = resolvedProject.parts.sleeve;

    if (body === undefined || sleeve === undefined) {
      throw new Error("Expected valid-blouse to resolve body and sleeve parts.");
    }

    const bodyArmhole = body.part.connectors?.armhole;
    const sleeveArmhole = sleeve.part.connectors?.armhole;

    if (bodyArmhole === undefined || sleeveArmhole === undefined) {
      throw new Error("Expected body and sleeve armhole connectors.");
    }

    const withGatherRanges: ResolvedProject = {
      ...resolvedProject,
      parts: {
        ...resolvedProject.parts,
        body: {
          ...body,
          part: {
            ...body.part,
            connectors: {
              armhole: {
                type: bodyArmhole.type,
                length_mm: bodyArmhole.length_mm,
                tolerance_mm: bodyArmhole.tolerance_mm,
                path_ref: bodyArmhole.path_ref,
                ranges: [
                  {
                    id: "gather-window",
                    from: 0.2,
                    to: 0.7,
                    behavior: "gathered",
                    allowance_mm: 18
                  }
                ]
              }
            }
          }
        },
        sleeve: {
          ...sleeve,
          part: {
            ...sleeve.part,
            connectors: {
              armhole: {
                type: sleeveArmhole.type,
                length_mm: sleeveArmhole.length_mm,
                tolerance_mm: sleeveArmhole.tolerance_mm,
                path_ref: sleeveArmhole.path_ref,
                ranges: [
                  {
                    id: "gather-window",
                    from: 0.1,
                    to: 0.6,
                    behavior: "gathered",
                    allowance_mm: 18
                  }
                ]
              }
            }
          }
        }
      }
    };

    const result = createSeamlintGeometryRequest(withGatherRanges);

    // Loomit は向き(ギャザー元/縫い先)を測れないので、逆向きになりうる gathered-seam check は request に
    // 載せない。check・parts とも空で、向き未確定と無検査の2警告だけ出す(警告は Seamlint には届かないが、
    // ambiguous な check を渡さないことが安全側の担保)。
    expect(result.request.checks).toEqual([]);
    expect(result.request.parts).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "SEAMLINT_GATHER_DIRECTION_UNRESOLVED",
        target: "body.armhole.gather-window/sleeve.armhole.gather-window"
      }),
      expect.objectContaining({
        severity: "warning",
        code: "SEAMLINT_CONNECTOR_LEFT_UNCHECKED",
        target: "body.armhole/sleeve.armhole"
      })
    ]);
  });

  it("warns and skips unsupported non-gathered connector ranges", async () => {
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const body = resolvedProject.parts.body;
    const sleeve = resolvedProject.parts.sleeve;

    if (body === undefined || sleeve === undefined) {
      throw new Error("Expected valid-blouse to resolve body and sleeve parts.");
    }

    const bodyArmhole = body.part.connectors?.armhole;
    const sleeveArmhole = sleeve.part.connectors?.armhole;

    if (bodyArmhole === undefined || sleeveArmhole === undefined) {
      throw new Error("Expected body and sleeve armhole connectors.");
    }

    const withEaseRanges: ResolvedProject = {
      ...resolvedProject,
      parts: {
        ...resolvedProject.parts,
        body: {
          ...body,
          part: {
            ...body.part,
            connectors: {
              armhole: {
                type: bodyArmhole.type,
                length_mm: bodyArmhole.length_mm,
                tolerance_mm: bodyArmhole.tolerance_mm,
                path_ref: bodyArmhole.path_ref,
                ranges: [
                  {
                    id: "ease-window",
                    from: 0.25,
                    to: 0.65,
                    behavior: "ease"
                  }
                ]
              }
            }
          }
        },
        sleeve: {
          ...sleeve,
          part: {
            ...sleeve.part,
            connectors: {
              armhole: {
                type: sleeveArmhole.type,
                length_mm: sleeveArmhole.length_mm,
                tolerance_mm: sleeveArmhole.tolerance_mm,
                path_ref: sleeveArmhole.path_ref,
                ranges: [
                  {
                    id: "ease-window",
                    from: 0.2,
                    to: 0.6,
                    behavior: "ease"
                  }
                ]
              }
            }
          }
        }
      }
    };

    const result = createSeamlintGeometryRequest(withEaseRanges);

    // ranged connector は check を出せないため、参照されない part path を残さないよう geometry も commit しない。
    expect(result.request.parts).toEqual([]);
    expect(result.request.checks).toEqual([]);
    // subrange が1つも check にならないと、その seam は whole-seam check も出ないので完全に無検査になる。
    // その退行を黙認しないことを明示する。
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "SEAMLINT_CONNECTOR_RANGE_BEHAVIOR_UNSUPPORTED",
        target: "body.armhole/sleeve.armhole"
      }),
      expect.objectContaining({
        severity: "warning",
        code: "SEAMLINT_CONNECTOR_LEFT_UNCHECKED",
        target: "body.armhole/sleeve.armhole"
      })
    ]);
  });

  it("warns when connector range ids do not match across the two seam sides", async () => {
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const body = resolvedProject.parts.body;
    const sleeve = resolvedProject.parts.sleeve;

    if (body === undefined || sleeve === undefined) {
      throw new Error("Expected valid-blouse to resolve body and sleeve parts.");
    }

    const bodyArmhole = body.part.connectors?.armhole;
    const sleeveArmhole = sleeve.part.connectors?.armhole;

    if (bodyArmhole === undefined || sleeveArmhole === undefined) {
      throw new Error("Expected body and sleeve armhole connectors.");
    }

    const withMismatchedRangeIds: ResolvedProject = {
      ...resolvedProject,
      parts: {
        ...resolvedProject.parts,
        body: {
          ...body,
          part: {
            ...body.part,
            connectors: {
              armhole: {
                type: bodyArmhole.type,
                length_mm: bodyArmhole.length_mm,
                tolerance_mm: bodyArmhole.tolerance_mm,
                path_ref: bodyArmhole.path_ref,
                ranges: [
                  {
                    id: "gather-window-front",
                    from: 0.2,
                    to: 0.7,
                    behavior: "gathered"
                  }
                ]
              }
            }
          }
        },
        sleeve: {
          ...sleeve,
          part: {
            ...sleeve.part,
            connectors: {
              armhole: {
                type: sleeveArmhole.type,
                length_mm: sleeveArmhole.length_mm,
                tolerance_mm: sleeveArmhole.tolerance_mm,
                path_ref: sleeveArmhole.path_ref,
                ranges: [
                  {
                    id: "gather-window-sleeve",
                    from: 0.1,
                    to: 0.6,
                    behavior: "gathered"
                  }
                ]
              }
            }
          }
        }
      }
    };

    const result = createSeamlintGeometryRequest(withMismatchedRangeIds);

    // ranged connector は check を出せないため、参照されない part path を残さないよう geometry も commit しない。
    expect(result.request.parts).toEqual([]);
    expect(result.request.checks).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "SEAMLINT_CONNECTOR_RANGE_MATCH_MISSING",
        target: "body.armhole/sleeve.armhole"
      }),
      expect.objectContaining({
        severity: "warning",
        code: "SEAMLINT_CONNECTOR_LEFT_UNCHECKED",
        target: "body.armhole/sleeve.armhole"
      })
    ]);
  });

  it("errors and skips a join id shared by three or more parts instead of dropping it silently", async () => {
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const sleeve = resolvedProject.parts.sleeve;

    if (sleeve === undefined) {
      throw new Error("Expected valid-blouse to resolve the sleeve part.");
    }

    // sleeve を複製した collar も armhole を宣言し、armhole を3パーツ共有の over-paired にする。
    const withOverpairedJoin: ResolvedProject = {
      ...resolvedProject,
      parts: {
        ...resolvedProject.parts,
        collar: {
          ...sleeve,
          role: "collar",
          filePath: join(fixturesRoot, "valid-blouse/parts/collar/part.loom")
        }
      }
    };

    const result = createSeamlintGeometryRequest(withOverpairedJoin);

    expect(result.request.checks).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: "error",
        code: "SEAMLINT_CONNECTOR_JOIN_OVERPAIRED",
        target: "armhole"
      })
    ]);
  });

  it("warns and skips a connector id declared by only one part (open join)", async () => {
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const body = resolvedProject.parts.body;
    const sleeve = resolvedProject.parts.sleeve;

    if (body === undefined || sleeve === undefined) {
      throw new Error("Expected valid-blouse to resolve body and sleeve parts.");
    }

    // sleeve から armhole を外し、body の armhole を相手待ちの open join にする。
    const withOpenJoin: ResolvedProject = {
      ...resolvedProject,
      parts: {
        ...resolvedProject.parts,
        sleeve: {
          ...sleeve,
          part: { ...sleeve.part, connectors: {} }
        }
      }
    };

    const result = createSeamlintGeometryRequest(withOpenJoin);

    expect(result.request.checks).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "SEAMLINT_CONNECTOR_JOIN_OPEN",
        target: "body.armhole"
      })
    ]);
  });

  it("keeps an explicit tolerance_mm of 0 (exact match) distinct from a looser paired tolerance", async () => {
    // 守る仕様: 片側だけが厳密一致(0)を要求しても、相手側の緩い tolerance で widen しない。
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const body = resolvedProject.parts.body;
    const sleeve = resolvedProject.parts.sleeve;

    if (body === undefined || sleeve === undefined) {
      throw new Error("Expected valid-blouse to resolve body and sleeve parts.");
    }

    const bodyArmhole = body.part.connectors?.armhole;
    const sleeveArmhole = sleeve.part.connectors?.armhole;

    if (bodyArmhole === undefined || sleeveArmhole === undefined) {
      throw new Error("Expected body and sleeve armhole connectors.");
    }

    const withZeroTolerance: ResolvedProject = {
      ...resolvedProject,
      parts: {
        ...resolvedProject.parts,
        body: {
          ...body,
          part: {
            ...body.part,
            connectors: { armhole: { ...bodyArmhole, tolerance_mm: 0 } }
          }
        },
        sleeve: {
          ...sleeve,
          part: {
            ...sleeve.part,
            connectors: { armhole: { ...sleeveArmhole, tolerance_mm: 5 } }
          }
        }
      }
    };

    const result = createSeamlintGeometryRequest(withZeroTolerance);

    expect(result.diagnostics).toEqual([]);
    expect(result.request.checks).toEqual([
      expect.objectContaining({
        id: "sewn-seam:body.armhole/sleeve.armhole",
        tolerance: { length_mm: 0 }
      })
    ]);
  });

  it("does not orphan a part in the request when its seam partner fails to resolve", async () => {
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const body = resolvedProject.parts.body;
    const sleeve = resolvedProject.parts.sleeve;

    if (body === undefined || sleeve === undefined) {
      throw new Error("Expected valid-blouse to resolve body and sleeve parts.");
    }

    const bodyArmhole = body.part.connectors?.armhole;
    const sleeveArmhole = sleeve.part.connectors?.armhole;

    if (bodyArmhole === undefined || sleeveArmhole === undefined) {
      throw new Error("Expected body and sleeve armhole connectors.");
    }

    // body 側は完全に有効。sleeve 側だけ path_ref を落とす(= あとから失敗する側)。
    const withPartnerFailure: ResolvedProject = {
      ...resolvedProject,
      parts: {
        ...resolvedProject.parts,
        sleeve: {
          ...sleeve,
          part: {
            ...sleeve.part,
            connectors: {
              armhole: { type: sleeveArmhole.type, length_mm: sleeveArmhole.length_mm }
            }
          }
        }
      }
    };

    const result = createSeamlintGeometryRequest(withPartnerFailure);

    // body は解決できても、相手が失敗した以上 checks から参照されない。孤立エントリを残さない。
    expect(result.request.parts).toEqual([]);
    expect(result.request.checks).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "SEAMLINT_CONNECTOR_PATH_REF_MISSING",
        target: "sleeve.armhole"
      })
    ]);
  });

  it("warns when the two gathered sides declare different allowance_mm", async () => {
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const body = resolvedProject.parts.body;
    const sleeve = resolvedProject.parts.sleeve;

    if (body === undefined || sleeve === undefined) {
      throw new Error("Expected valid-blouse to resolve body and sleeve parts.");
    }

    const bodyArmhole = body.part.connectors?.armhole;
    const sleeveArmhole = sleeve.part.connectors?.armhole;

    if (bodyArmhole === undefined || sleeveArmhole === undefined) {
      throw new Error("Expected body and sleeve armhole connectors.");
    }

    const withAllowanceMismatch: ResolvedProject = {
      ...resolvedProject,
      parts: {
        ...resolvedProject.parts,
        body: {
          ...body,
          part: {
            ...body.part,
            connectors: {
              armhole: {
                ...bodyArmhole,
                ranges: [{ id: "gather-window", from: 0.2, to: 0.7, behavior: "gathered", allowance_mm: 18 }]
              }
            }
          }
        },
        sleeve: {
          ...sleeve,
          part: {
            ...sleeve.part,
            connectors: {
              armhole: {
                ...sleeveArmhole,
                ranges: [{ id: "gather-window", from: 0.1, to: 0.6, behavior: "gathered", allowance_mm: 12 }]
              }
            }
          }
        }
      }
    };

    const result = createSeamlintGeometryRequest(withAllowanceMismatch);

    // gathered は向き未確定で check を出さないので、allowance 不一致は check を止める前に警告として拾う。
    expect(result.request.checks).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "SEAMLINT_CONNECTOR_RANGE_ALLOWANCE_MISMATCH",
        target: "body.armhole.gather-window/sleeve.armhole.gather-window"
      }),
      expect.objectContaining({
        severity: "warning",
        code: "SEAMLINT_GATHER_DIRECTION_UNRESOLVED"
      }),
      expect.objectContaining({
        severity: "warning",
        code: "SEAMLINT_CONNECTOR_LEFT_UNCHECKED"
      })
    ]);
  });

  it("reports a missing geometry source once for a part shared by multiple joins", async () => {
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const body = resolvedProject.parts.body;
    const sleeve = resolvedProject.parts.sleeve;

    if (body === undefined || sleeve === undefined) {
      throw new Error("Expected valid-blouse to resolve body and sleeve parts.");
    }

    const bodyArmhole = body.part.connectors?.armhole;
    const sleeveArmhole = sleeve.part.connectors?.armhole;

    if (bodyArmhole === undefined || sleeveArmhole === undefined) {
      throw new Error("Expected body and sleeve armhole connectors.");
    }

    // body は armhole(→sleeve)と waist(→skirt)の2つの join に参加するが、preview/geometry を持たない。
    // 欠落は part 単位の1事実なので、警告は join の数だけ重複せず1度だけ出す。
    const withSharedPartMissingSource: ResolvedProject = {
      ...resolvedProject,
      parts: {
        body: {
          ...body,
          part: {
            ...body.part,
            files: omitPreview(body.part.files),
            connectors: {
              armhole: { ...bodyArmhole },
              waist: { type: "waist", path_ref: "svg:path#body-waist" }
            }
          }
        },
        sleeve: {
          ...sleeve,
          part: { ...sleeve.part, connectors: { armhole: { ...sleeveArmhole } } }
        },
        skirt: {
          ...sleeve,
          role: "skirt",
          filePath: join(fixturesRoot, "valid-blouse/parts/skirt/part.loom"),
          part: {
            ...sleeve.part,
            connectors: { waist: { type: "waist", path_ref: "svg:path#skirt-waist" } }
          }
        }
      }
    };

    const result = createSeamlintGeometryRequest(withSharedPartMissingSource);

    const bodySourceMissing = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "SEAMLINT_GEOMETRY_SOURCE_MISSING" &&
        diagnostic.target === join(fixturesRoot, "valid-blouse/parts/body/part.loom")
    );
    expect(bodySourceMissing).toHaveLength(1);
  });

  it("skips a join whose identifier contains a reserved separator to avoid key collisions", async () => {
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const body = resolvedProject.parts.body;
    const sleeve = resolvedProject.parts.sleeve;

    if (body === undefined || sleeve === undefined) {
      throw new Error("Expected valid-blouse to resolve body and sleeve parts.");
    }

    const connector = { type: "seam", path_ref: "svg:path#seam" };
    const withUnsafeJoinId: ResolvedProject = {
      ...resolvedProject,
      parts: {
        body: {
          ...body,
          part: { ...body.part, connectors: { "arm.hole": { ...connector } } }
        },
        sleeve: {
          ...sleeve,
          part: { ...sleeve.part, connectors: { "arm.hole": { ...connector } } }
        }
      }
    };

    const result = createSeamlintGeometryRequest(withUnsafeJoinId);

    expect(result.request.checks).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "SEAMLINT_UNSAFE_JOIN_IDENTIFIER"
      })
    ]);
  });
});

async function loadResolvedFixture(fixtureName: string): Promise<ResolvedProject> {
  const loadedProject = await loadProject(join(fixturesRoot, fixtureName));

  if (!loadedProject.ok) {
    throw new Error("Expected fixture project to load.");
  }

  const resolvedProject = await resolveParts(loadedProject.value);

  if (!resolvedProject.ok) {
    throw new Error("Expected fixture parts to resolve.");
  }

  return resolvedProject.value;
}

function omitPreview(
  files:
    | {
        readonly source?: string | undefined;
        readonly piece?: string | undefined;
        readonly preview?: string | undefined;
        readonly print?: string | undefined;
      }
    | undefined
): {
  readonly source?: string;
  readonly piece?: string;
  readonly print?: string;
} {
  if (files === undefined) {
    return {};
  }

  return {
    ...(files.source === undefined ? {} : { source: files.source }),
    ...(files.piece === undefined ? {} : { piece: files.piece }),
    ...(files.print === undefined ? {} : { print: files.print })
  };
}
