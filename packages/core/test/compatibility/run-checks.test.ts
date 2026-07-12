import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  createCompatibilityResult,
  loadProject,
  resolveParts,
  runChecks
} from "../../src/index.js";
import type { CompatibilityRule, ResolvedProject, ResolvedProjectPart } from "../../src/index.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

describe("runChecks", () => {
  it("returns ok connector compatibility and requirement checks for a valid project", async () => {
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const report = runChecks(resolvedProject);

    expect(report.status).toBe("ok");
    expect(report.diagnostics).toEqual([]);
    expect(report.compatibility).toEqual([
      {
        status: "ok",
        from: "body.armhole",
        to: "sleeve.armhole",
        rule: "connector-length",
        actual: {
          fromLengthMm: 469,
          toLengthMm: 470,
          differenceMm: 1
        },
        expected: {
          toleranceMm: 3
        },
        diagnostics: []
      },
      {
        status: "ok",
        from: "body.requires.sleeve.armhole.length_mm",
        to: "sleeve.armhole.length_mm",
        rule: "requirement-range",
        actual: {
          value: 470
        },
        expected: {
          min: 466,
          max: 472
        },
        diagnostics: []
      },
      {
        status: "ok",
        from: "sleeve.requires.body.armhole.length_mm",
        to: "body.armhole.length_mm",
        rule: "requirement-range",
        actual: {
          value: 469
        },
        expected: {
          min: 467,
          max: 473
        },
        diagnostics: []
      }
    ]);
  });

  it("reports connector length and requirement range mismatches", async () => {
    const resolvedProject = await loadResolvedFixture("length-mismatch");
    const report = runChecks(resolvedProject);

    expect(report.status).toBe("error");
    expect(report.diagnostics).toEqual([]);
    expect(report.compatibility).toEqual([
      {
        status: "error",
        from: "body.armhole",
        to: "sleeve.armhole",
        rule: "connector-length",
        actual: {
          fromLengthMm: 469,
          toLengthMm: 480,
          differenceMm: 11
        },
        expected: {
          toleranceMm: 3
        },
        diagnostics: [
          {
            severity: "error",
            code: "CONNECTOR_LENGTH_MISMATCH",
            message:
              "コネクタの仕上がり線の長さが許容差を超えています。/ Connector finished seam lengths exceed the tolerance.",
            target: "sleeve.armhole",
            suggestion: [
              "body.armhole and sleeve.armhole differ by 11mm; allowed tolerance is 3mm."
            ]
          }
        ]
      },
      {
        status: "error",
        from: "body.requires.sleeve.armhole.length_mm",
        to: "sleeve.armhole.length_mm",
        rule: "requirement-range",
        actual: {
          value: 480
        },
        expected: {
          min: 466,
          max: 472
        },
        diagnostics: [
          {
            severity: "error",
            code: "REQUIREMENT_RANGE_UNSATISFIED",
            message:
              "要求条件の範囲を満たしていません。/ The requirement range is not satisfied.",
            target: "sleeve.armhole.length_mm",
            suggestion: [
              "sleeve.armhole.length_mm is 480, but expected min 466, max 472."
            ]
          }
        ]
      },
      {
        status: "error",
        from: "sleeve.requires.body.armhole.length_mm",
        to: "body.armhole.length_mm",
        rule: "requirement-range",
        actual: {
          value: 469
        },
        expected: {
          min: 477,
          max: 483
        },
        diagnostics: [
          {
            severity: "error",
            code: "REQUIREMENT_RANGE_UNSATISFIED",
            message:
              "要求条件の範囲を満たしていません。/ The requirement range is not satisfied.",
            target: "body.armhole.length_mm",
            suggestion: [
              "body.armhole.length_mm is 469, but expected min 477, max 483."
            ]
          }
        ]
      }
    ]);
  });

  it("does not compare direct connector lengths with different connector ids", async () => {
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const body = getResolvedPart(resolvedProject, "body");
    const sleeve = getResolvedPart(resolvedProject, "sleeve");
    const report = runChecks({
      ...resolvedProject,
      parts: {
        body,
        sleeve: {
          ...sleeve,
          part: {
            ...sleeve.part,
            connectors: {
              cuff: {
                type: "cuff",
                length_mm: 470,
                tolerance_mm: 3
              }
            },
            requires: {}
          }
        }
      }
    });

    expect(report.compatibility).not.toContainEqual(
      expect.objectContaining({
        rule: "connector-length"
      })
    );
  });

  it("warns instead of comparing when a matched connector length is unmeasured", async () => {
    // 守る仕様: 対になる connector があっても、片方の length_mm が未測定なら長さを比較できない。
    // 0 とみなして偽の不一致(NaN 比較)を出さず、「接続整合を未確認」の warning に振り替える。
    // 値は Valentina / truer が後で測って埋める(A案: 幾何の測定は Loomit の外)。
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const body = getResolvedPart(resolvedProject, "body");
    const sleeve = getResolvedPart(resolvedProject, "sleeve");
    const report = runChecks({
      ...resolvedProject,
      parts: {
        body,
        sleeve: {
          ...sleeve,
          part: {
            ...sleeve.part,
            // length_mm を落とし(未測定)、requires は本テストの対象外なので空にして connector-length に絞る。
            connectors: {
              armhole: { type: "armhole", tolerance_mm: 3, path_ref: "svg:path#sleeve-armhole" }
            },
            requires: {}
          }
        }
      }
    });

    // 未測定は warning(check は失敗させない)。
    expect(report.status).toBe("warning");
    expect(report.compatibility).toContainEqual({
      status: "warning",
      from: "body.armhole",
      to: "sleeve.armhole",
      rule: "connector-length",
      actual: undefined,
      expected: undefined,
      diagnostics: [
        {
          severity: "warning",
          code: "CONNECTOR_LENGTH_UNMEASURED",
          message:
            "コネクタの仕上がり線の長さが未測定のため、接続整合を確認できません。/ Connector finished seam length is unmeasured; cannot verify the seam fit.",
          target: "sleeve.armhole",
          suggestion: [
            "Measure the seam length in Valentina and set length_mm on sleeve.armhole."
          ]
        }
      ]
    });
    // 未測定を 0 と誤解して不一致にしない。
    expect(report.compatibility).not.toContainEqual(
      expect.objectContaining({
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: "CONNECTOR_LENGTH_MISMATCH" })
        ])
      })
    );
  });

  it("warns that a requirement cannot be checked when the target length is unmeasured", async () => {
    // 守る仕様: requires が参照する connector が未測定のとき、「未対応」ではなく「未測定」を伝える
    // (property は対応済みで、値が .val 評価待ちなだけ)。
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const body = getResolvedPart(resolvedProject, "body");
    const sleeve = getResolvedPart(resolvedProject, "sleeve");
    const report = runChecks({
      ...resolvedProject,
      parts: {
        body,
        sleeve: {
          ...sleeve,
          part: {
            ...sleeve.part,
            connectors: {
              armhole: { type: "armhole", tolerance_mm: 3, path_ref: "svg:path#sleeve-armhole" }
            },
            requires: {}
          }
        }
      }
    });

    expect(report.compatibility).toContainEqual({
      status: "warning",
      from: "body.requires.sleeve.armhole.length_mm",
      to: "sleeve.armhole.length_mm",
      rule: "requirement-range",
      expected: {
        min: 466,
        max: 472
      },
      diagnostics: [
        {
          severity: "warning",
          code: "CONNECTOR_LENGTH_UNMEASURED",
          message:
            "要求条件の参照先コネクタの length_mm が未測定のため、条件を確認できません。/ The connector referenced by the requirement has an unmeasured length_mm; cannot check the requirement.",
          target: "sleeve.armhole.length_mm",
          suggestion: [
            "Measure the seam length in Valentina and set length_mm on sleeve.armhole."
          ]
        }
      ]
    });
  });

  it("reports missing connectors referenced by requirements", async () => {
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const body = getResolvedPart(resolvedProject, "body");
    const sleeve = getResolvedPart(resolvedProject, "sleeve");
    const report = runChecks({
      ...resolvedProject,
      parts: {
        body,
        sleeve: {
          ...sleeve,
          part: {
            ...sleeve.part,
            connectors: {}
          }
        }
      }
    });

    expect(report.status).toBe("error");
    expect(report.compatibility).toContainEqual({
      status: "error",
      from: "body.requires.sleeve.armhole.length_mm",
      to: "sleeve.armhole.length_mm",
      rule: "requirement-range",
      expected: {
        min: 466,
        max: 472
      },
      diagnostics: [
        {
          severity: "error",
          code: "CONNECTOR_MISSING",
          message:
            "要求条件の参照先コネクタが見つかりません。/ Could not find the connector referenced by the requirement.",
          target: "sleeve.armhole.length_mm",
          suggestion: [
            'Add connector "armhole" to part "sleeve", or update the requirement target.'
          ]
        }
      ]
    });
  });

  it("can run a supplied compatibility rule registry instead of the default rules", async () => {
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const customRule: CompatibilityRule = {
      id: "custom-project-name",
      description: "Checks custom project naming constraints.",
      check: (project) => [
        createCompatibilityResult({
          from: "project.name",
          to: project.project.name,
          rule: "custom-project-name",
          actual: {
            name: project.project.name
          },
          expected: {
            prefix: "sample-"
          }
        })
      ]
    };
    const report = runChecks(resolvedProject, {
      rules: [customRule]
    });

    expect(report).toEqual({
      status: "ok",
      diagnostics: [],
      compatibility: [
        {
          status: "ok",
          from: "project.name",
          to: "valid-blouse",
          rule: "custom-project-name",
          actual: {
            name: "valid-blouse"
          },
          expected: {
            prefix: "sample-"
          },
          diagnostics: []
        }
      ]
    });
  });

  it("warns about an open connector join declared by only one part", async () => {
    // 守る仕様: connector は2パーツを縫い合わせる cross-part join。相手が居ない(1パーツだけが宣言)join は
    // 相手待ち / id の取り違え / 自己シーム誤登録のいずれかなので、error ではなく warning で surface する。
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const body = getResolvedPart(resolvedProject, "body");
    const sleeve = getResolvedPart(resolvedProject, "sleeve");
    // body だけが armhole を宣言し、sleeve は別 id(cuff)を持つ → armhole は相手待ちの open join。
    const report = runChecks({
      ...resolvedProject,
      parts: {
        body: { ...body, part: { ...body.part, requires: {} } },
        sleeve: {
          ...sleeve,
          part: {
            ...sleeve.part,
            connectors: { cuff: { type: "cuff", length_mm: 200, tolerance_mm: 3 } },
            requires: {}
          }
        }
      }
    });

    expect(report.status).toBe("warning");
    expect(report.compatibility).toContainEqual({
      status: "warning",
      from: "body.armhole",
      to: "(no mate)",
      rule: "connector-pairing",
      actual: undefined,
      expected: undefined,
      diagnostics: [
        {
          severity: "warning",
          code: "CONNECTOR_JOIN_OPEN",
          message:
            "コネクタの縫い合わせ相手がいません(1つのパーツだけが宣言)。/ Connector join has no mate; only one part declares it.",
          target: "body.armhole",
          suggestion: [
            'Add a part that also declares connector "armhole", fix a mismatched id, or if "armhole" is an internal (self) seam, check it in Seamlint instead of declaring a connector.'
          ]
        }
      ]
    });
  });

  it("does not flag a join shared by three parts with no side (a stacked/coincident seam)", async () => {
    // 守る仕様(assembly (d)): 「1本の縫い目=2枚」とは限らない。side を宣言しない縫い目は coincident(重ね)として
    // 3枚以上でも健全(旧 over-pair error は退役)。長さの実測は Seamlint に defer(pairwise 長さ比較は打ち切る)。
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const body = getResolvedPart(resolvedProject, "body");
    const sleeve = getResolvedPart(resolvedProject, "sleeve");
    const collar: ResolvedProjectPart = {
      role: "collar",
      filePath: sleeve.filePath,
      part: {
        ...sleeve.part,
        type: "collar",
        connectors: { armhole: { type: "armhole", length_mm: 470, tolerance_mm: 3 } },
        requires: {}
      }
    };
    const report = runChecks({
      ...resolvedProject,
      parts: {
        body: { ...body, part: { ...body.part, requires: {} } },
        sleeve: { ...sleeve, part: { ...sleeve.part, requires: {} } },
        collar
      }
    });

    expect(report.compatibility).not.toContainEqual(
      expect.objectContaining({ rule: "connector-pairing" })
    );
    // pairwise でない縫い目は長さ比較を打ち切る。
    expect(report.compatibility).not.toContainEqual(
      expect.objectContaining({ rule: "connector-length" })
    );
  });

  it("errors when a seam declares more than two sides", async () => {
    // 守る仕様(assembly (d)): 1本の縫い目は2つの unit(側)まで。3側は組めないので error。
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const body = getResolvedPart(resolvedProject, "body");
    const sleeve = getResolvedPart(resolvedProject, "sleeve");
    const collar: ResolvedProjectPart = {
      role: "collar",
      filePath: sleeve.filePath,
      part: {
        ...sleeve.part,
        type: "collar",
        connectors: { armhole: { type: "armhole", side: "collar" } },
        requires: {}
      }
    };
    const report = runChecks({
      ...resolvedProject,
      parts: {
        body: {
          ...body,
          part: { ...body.part, connectors: { armhole: { type: "armhole", side: "bodice" } }, requires: {} }
        },
        sleeve: {
          ...sleeve,
          part: { ...sleeve.part, connectors: { armhole: { type: "armhole", side: "sleeve" } }, requires: {} }
        },
        collar
      }
    });

    expect(report.status).toBe("error");
    expect(report.compatibility).toContainEqual(
      expect.objectContaining({
        rule: "connector-pairing",
        diagnostics: [
          expect.objectContaining({
            severity: "error",
            code: "CONNECTOR_JOIN_TOO_MANY_SIDES",
            target: "armhole"
          })
        ]
      })
    );
  });

  it("warns when a contiguous side's parts are not joined into a unit by other seams", async () => {
    // 守る仕様(narrow (B)): 「{body, collar} を bodice 側(unit)」と宣言したのに、その2枚を繋ぐ別の縫い目が無いと
    // グラフ上 unit になっていない。辺は知らずグラフ到達性だけで warning(ブロックはしない)。
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const body = getResolvedPart(resolvedProject, "body");
    const sleeve = getResolvedPart(resolvedProject, "sleeve");
    const collar: ResolvedProjectPart = {
      role: "collar",
      filePath: sleeve.filePath,
      part: {
        ...sleeve.part,
        type: "collar",
        connectors: { armhole: { type: "armhole", side: "bodice" } },
        requires: {}
      }
    };
    const report = runChecks({
      ...resolvedProject,
      parts: {
        body: {
          ...body,
          part: { ...body.part, connectors: { armhole: { type: "armhole", side: "bodice" } }, requires: {} }
        },
        sleeve: {
          ...sleeve,
          part: { ...sleeve.part, connectors: { armhole: { type: "armhole", side: "sleeve" } }, requires: {} }
        },
        collar
      }
    });

    // armhole は bodice={body, collar} / sleeve={sleeve} で 2 側=健全だが、bodice の2枚が他の縫い目で繋がってない。
    expect(report.compatibility).toContainEqual(
      expect.objectContaining({
        rule: "connector-pairing",
        diagnostics: [
          expect.objectContaining({
            severity: "warning",
            code: "CONNECTOR_UNIT_DISCONNECTED",
            target: "armhole.bodice"
          })
        ]
      })
    );
  });

  it("treats a contiguous two-side seam as healthy when each side is a connected unit", async () => {
    // 守る仕様(assembly (d)): body+collar を bodice 側とし、別の縫い目(neckline)で互いに繋がっていれば unit として
    // 健全。armhole は 2 側で OK・連結性も満たすので connector-pairing の結果を出さない。
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const body = getResolvedPart(resolvedProject, "body");
    const sleeve = getResolvedPart(resolvedProject, "sleeve");
    const collar: ResolvedProjectPart = {
      role: "collar",
      filePath: sleeve.filePath,
      part: {
        ...sleeve.part,
        type: "collar",
        connectors: {
          armhole: { type: "armhole", side: "bodice" },
          neckline: { type: "neckline" }
        },
        requires: {}
      }
    };
    const report = runChecks({
      ...resolvedProject,
      parts: {
        body: {
          ...body,
          part: {
            ...body.part,
            connectors: {
              armhole: { type: "armhole", side: "bodice" },
              neckline: { type: "neckline" }
            },
            requires: {}
          }
        },
        sleeve: {
          ...sleeve,
          part: { ...sleeve.part, connectors: { armhole: { type: "armhole", side: "sleeve" } }, requires: {} }
        },
        collar
      }
    });

    expect(report.compatibility).not.toContainEqual(
      expect.objectContaining({ rule: "connector-pairing" })
    );
  });

  it("does not add a connector-pairing result for a healthy two-part join", async () => {
    // 健全な N=2 のペア(armhole を body と sleeve が宣言)には connector-pairing の結果を出さない。
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const report = runChecks(resolvedProject);

    expect(report.compatibility).not.toContainEqual(
      expect.objectContaining({ rule: "connector-pairing" })
    );
  });
  it("treats an explicit tolerance_mm of 0 as stricter than the other side's looser tolerance", async () => {
    // 守る仕様: exact-match を要求する 0 tolerance は、相手側の緩い tolerance によって widen されない。
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const body = getResolvedPart(resolvedProject, "body");
    const sleeve = getResolvedPart(resolvedProject, "sleeve");
    const bodyArmhole = body.part.connectors?.armhole;
    const sleeveArmhole = sleeve.part.connectors?.armhole;

    if (bodyArmhole === undefined || sleeveArmhole === undefined) {
      throw new Error("Expected body and sleeve armhole connectors.");
    }

    const report = runChecks({
      ...resolvedProject,
      parts: {
        body: {
          ...body,
          part: {
            ...body.part,
            connectors: { armhole: { ...bodyArmhole, tolerance_mm: 0 } },
            requires: {}
          }
        },
        sleeve: {
          ...sleeve,
          part: {
            ...sleeve.part,
            connectors: { armhole: { ...sleeveArmhole, tolerance_mm: 5 } },
            requires: {}
          }
        }
      }
    });

    expect(report.compatibility).toContainEqual(
      expect.objectContaining({
        rule: "connector-length",
        expected: { toleranceMm: 0 },
        diagnostics: [
          expect.objectContaining({
            code: "CONNECTOR_LENGTH_MISMATCH"
          })
        ]
      })
    );
  });
});

async function loadResolvedFixture(fixtureName: string): Promise<ResolvedProject> {
  const loadedProject = expectLoaded(await loadProject(join(fixturesRoot, fixtureName)));
  return expectLoaded(await resolveParts(loadedProject));
}

function expectLoaded<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) {
    throw new Error("Expected project to load.");
  }

  return result.value;
}

function getResolvedPart(
  resolvedProject: ResolvedProject,
  role: string
): ResolvedProjectPart {
  const part = resolvedProject.parts[role];

  if (part === undefined) {
    throw new Error(`Expected resolved part for role "${role}".`);
  }

  return part;
}
