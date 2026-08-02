import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadProfileFile } from "../../src/profile/loadProfile.js";
import { getStatusForDiagnostics, loadProject, resolveParts } from "../../src/index.js";
import { runFit } from "../../src/fit/runFit.js";
import type { Diagnostic, FitRule, ResolvedProject, ResolvedProjectPart } from "../../src/index.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

describe("runFit", () => {
  it("reports ok ease for available basic body measurements", async () => {
    // 守る仕様: 基本寸法(bust/waist/hip)が揃っていれば、各測定の ease を cm で算出し status:"ok" を返す。
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const profile = await loadProfileFixture("my-size.yml");
    const report = runFit(resolvedProject, profile);

    expect(report).toEqual({
      status: "ok",
      diagnostics: [],
      measurements: [
        {
          id: "bust",
          status: "ok",
          bodyMeasurementCm: 84,
          garmentMeasurementCm: 96,
          easeCm: 12,
          source: {
            partRole: "body",
            measurement: "measurements.finished.bust_width_mm"
          },
          diagnostics: []
        },
        {
          id: "waist",
          status: "ok",
          bodyMeasurementCm: 66,
          garmentMeasurementCm: 74,
          easeCm: 8,
          source: {
            partRole: "body",
            measurement: "measurements.finished.waist_width_mm"
          },
          diagnostics: []
        },
        {
          id: "hip",
          status: "ok",
          bodyMeasurementCm: 92,
          garmentMeasurementCm: 100,
          easeCm: 8,
          source: {
            partRole: "body",
            measurement: "measurements.finished.hip_width_mm"
          },
          diagnostics: []
        }
      ]
    });
  });

  it("reports negative bust ease as an error", async () => {
    // 守る仕様: 仕上がり幅が身体寸法より小さい(ease が負)なら FIT_EASE_NEGATIVE を error として出す。
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const profile = await loadProfileFixture("my-size.yml");
    const report = runFit(withBodyBustWidth(resolvedProject, 410), profile);

    expect(report.status).toBe("error");
    expect(report.measurements[0]).toEqual({
      id: "bust",
      status: "error",
      bodyMeasurementCm: 84,
      garmentMeasurementCm: 82,
      easeCm: -2,
      source: {
        partRole: "body",
        measurement: "measurements.finished.bust_width_mm"
      },
      diagnostics: [
        {
          severity: "error",
          code: "FIT_EASE_NEGATIVE",
          message: "服の仕上がりバストが、体のバスト寸法より小さくなっています。 / Garment finished bust is smaller than the body bust measurement.",
          target: "body.measurements.finished.bust_width_mm",
          suggestion: ["Body bust is 84cm, garment bust is 82cm, ease is -2cm."]
        }
      ]
    });
  });

  it("reports low positive bust ease as a warning", async () => {
    // 守る仕様: ease が正でも推奨最小(bust=6cm)を下回れば FIT_EASE_LOW を warning として出す。
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const profile = await loadProfileFixture("my-size.yml");
    const report = runFit(withBodyBustWidth(resolvedProject, 440), profile);

    expect(report.status).toBe("warning");
    expect(report.measurements[0]?.diagnostics).toEqual([
      {
        severity: "warning",
        code: "FIT_EASE_LOW",
        message: "服の仕上がりバストのゆとりが少なめです。 / Garment finished bust ease is low.",
        target: "body.measurements.finished.bust_width_mm",
        suggestion: [
          "Body bust is 84cm, garment bust is 88cm, ease is 4cm; suggested minimum is 6cm."
        ]
      }
    ]);
  });

  it("reports low waist ease with waist-specific source information", async () => {
    // 守る仕様: waist の ease 不足は、waist 固有の source(measurements.finished.waist_width_mm)を添えて FIT_EASE_LOW を出す。
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const profile = await loadProfileFixture("my-size.yml");
    const report = runFit(
      withBodyFinishedMeasurements(resolvedProject, { waist_width_mm: 340 }),
      profile
    );

    expect(report.status).toBe("warning");
    expect(report.measurements.find((measurement) => measurement.id === "waist")).toEqual({
      id: "waist",
      status: "warning",
      bodyMeasurementCm: 66,
      garmentMeasurementCm: 68,
      easeCm: 2,
      source: {
        partRole: "body",
        measurement: "measurements.finished.waist_width_mm"
      },
      diagnostics: [
        {
          severity: "warning",
          code: "FIT_EASE_LOW",
          message: "服の仕上がりウエストのゆとりが少なめです。 / Garment finished waist ease is low.",
          target: "body.measurements.finished.waist_width_mm",
          suggestion: [
            "Body waist is 66cm, garment waist is 68cm, ease is 2cm; suggested minimum is 4cm."
          ]
        }
      ]
    });
  });

  it("can run supplied fit rules instead of the default ease rule", async () => {
    // 守る仕様: rules を渡すと既定の ease ルールの代わりにその fit ルールで検査できる(ルール差し替えの拡張点)。
    // 守る仕様: 注入した rule は Loomit の語彙に無い診断コードを X_ 接頭辞で出せる(拡張点は code まで開いている)。
    const resolvedProject = await loadResolvedFixture("valid-blouse");
    const profile = await loadProfileFixture("my-size.yml");
    const customRule: FitRule = {
      id: "custom-neck-to-wrist",
      description: "Checks a custom length preference.",
      check: () => {
        const diagnostics: readonly Diagnostic[] = [
          {
            severity: "warning",
            code: "X_FIT_CUSTOM_LENGTH_NOTE",
            message: "Custom length preference should be reviewed.",
            target: "profile.preferences.length"
          }
        ];

        return [
          {
            id: "custom-length",
            status: getStatusForDiagnostics(diagnostics),
            bodyMeasurementCm: 72,
            garmentMeasurementCm: 76,
            easeCm: 4,
            source: {
              partRole: "body",
              measurement: "measurements.finished.custom_length_mm"
            },
            diagnostics
          }
        ];
      }
    };
    const report = runFit(resolvedProject, profile, {
      rules: [customRule]
    });

    expect(report).toEqual({
      status: "warning",
      diagnostics: [],
      measurements: [
        {
          id: "custom-length",
          status: "warning",
          bodyMeasurementCm: 72,
          garmentMeasurementCm: 76,
          easeCm: 4,
          source: {
            partRole: "body",
            measurement: "measurements.finished.custom_length_mm"
          },
          diagnostics: [
            {
              severity: "warning",
              code: "X_FIT_CUSTOM_LENGTH_NOTE",
              message: "Custom length preference should be reviewed.",
              target: "profile.preferences.length"
            }
          ]
        }
      ]
    });
  });
});

async function loadResolvedFixture(fixtureName: string): Promise<ResolvedProject> {
  const loadedProject = expectLoaded(await loadProject(join(fixturesRoot, fixtureName)));
  return expectLoaded(await resolveParts(loadedProject));
}

async function loadProfileFixture(fixtureName: string) {
  return expectLoaded(await loadProfileFile(join(fixturesRoot, "profiles", fixtureName)));
}

function expectLoaded<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) {
    throw new Error("Expected file to load.");
  }

  return result.value;
}

function withBodyBustWidth(project: ResolvedProject, bustWidthMm: number): ResolvedProject {
  return withBodyFinishedMeasurements(project, {
    bust_width_mm: bustWidthMm
  });
}

function withBodyFinishedMeasurements(
  project: ResolvedProject,
  measurements: Readonly<Record<string, number>>
): ResolvedProject {
  const body = getResolvedPart(project, "body");

  return {
    ...project,
    parts: {
      ...project.parts,
      body: {
        ...body,
        part: {
          ...body.part,
          measurements: {
            ...body.part.measurements,
            finished: {
              ...body.part.measurements?.finished,
              ...measurements
            }
          }
        }
      }
    }
  };
}

function getResolvedPart(project: ResolvedProject, role: string): ResolvedProjectPart {
  const part = project.parts[role];

  if (part === undefined) {
    throw new Error(`Expected resolved part for role "${role}".`);
  }

  return part;
}
