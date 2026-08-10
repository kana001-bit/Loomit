import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

import * as core from "../src/index.js";

describe("core public API surface", () => {
  it("exports exactly the intended values", () => {
    // 守る仕様: バレルの値 export は、下の一覧そのもの。増えても減っても落ちる。
    // index.ts は「新しい関数はとりあえずバレルに足す」で 34 コミット育ってきた履歴があり、
    // 公開面は放っておくと増える。ここを通すために一覧を書き足す一手間が、公開の意思表示になる。
    expect(Object.keys(core).sort()).toEqual([...publicValues]);
  });

  it("reads the barrel the same way the module system does", () => {
    // 守る仕様: バレルの解析器(readBarrelExports)が実物とずれていない。
    // 型は実行時に消えるので型の一覧は AST でしか検査できず、その解析器が信用できるかどうかは
    // 値側でしか確かめられない。ここが一致している限り、下の型テストも同じ精度で読める。
    expect(readBarrelExports().values).toEqual(Object.keys(core).sort());
  });

  it("exports exactly the intended types", () => {
    // 守る仕様: 型の公開面も一覧で固定する。
    // AST で読むので `export type { X } from …`(宣言ごと)と `export { type X } from …`(要素ごと)を
    // どちらも型として数え、コメントアウトされた export 行は数えない。
    expect(readBarrelExports().types).toEqual([...publicTypes]);
  });

  it("re-exports named symbols only", () => {
    // 守る仕様: バレルで `export * from "…"` を使わない。使うと公開集合がこのファイルの見た目から
    // 決まらなくなり(相手モジュールに足された export が黙って公開面に増える)、一覧で固定する意味が消える。
    expect(readBarrelExports().starExports).toEqual([]);
  });

  it("classifies each export form the barrel could use", () => {
    // 守る仕様: 解析器そのものの分類。バレルがいま再輸出だけで書かれているせいで、他のテストは
    // 解析器が「知らない構文を読み飛ばす」形で壊れても通ってしまう。ここで各構文を直接食わせて固定する。
    // とくに型の直接宣言と `export type * as NS` は実行時に見えないので、ここが唯一の担保になる。
    const sample = [
      'export const valueConst = "x";',
      "export function valueFunction() {}",
      "export class ValueClass {}",
      "export enum ValueEnum { A }",
      "export interface TypeInterface { a: string }",
      "export type TypeAlias = string;",
      'export { type TypeInValueClause, plainValue } from "./a.js";',
      'export type { TypeOnlyClause } from "./b.js";',
      'export type * as TypeNamespace from "./c.js";',
      'export * as ValueNamespace from "./d.js";',
      'export * from "./e.js";',
      "export default 1;",
      '// export type { CommentedOut } from "./f.js";',
      "const notExported = 1;"
    ].join("\n");

    const parsed = parseExports(sample);

    expect(parsed.values).toEqual([
      "ValueClass",
      "ValueEnum",
      "ValueNamespace",
      "plainValue",
      "valueConst",
      "valueFunction"
    ]);
    expect(parsed.types).toEqual([
      "TypeAlias",
      "TypeInValueClause",
      "TypeInterface",
      "TypeNamespace",
      "TypeOnlyClause"
    ]);
    expect(parsed.starExports).toEqual(['"./e.js"']);
    // `export default 1;` だけが読み方を決めていない構文。コメントと非 export の宣言は数に入らない。
    expect(parsed.unsupported).toEqual(["ExportAssignment (line 12)"]);
  });

  it("understands every export form written in the barrel", () => {
    // 守る仕様: 解析器が読み方を知らない export 構文をバレルに書かない。
    // 知らない構文を黙って読み飛ばすと「公開されていない」と同じ結果になる。とくに `export interface X` /
    // `export type X = …` / `export type * as NS from "…"` は実行時に見えないので、値側の突き合わせでも
    // 捕まらず、公開面が誰にも気づかれずに増える。読めなかった export 文はここで名前と行番号を出して落とす。
    expect(readBarrelExports().unsupported).toEqual([]);
  });

  it("keeps the internal read helpers out of the barrel", () => {
    // 守る仕様: YAML パースとテキスト読み(parseYamlText / readText)は core 内部の下請けで、公開面ではない。
    // 上の一覧テストでも落ちるが、この2つは「未使用だから外した」のではなく「内部実装だから外した」ので、
    // 判断そのものを名前で残す。公開面に戻すなら、それは契約を1つ増やす決定になる。
    const { values, types } = readBarrelExports();
    const exported = new Set([...values, ...types]);

    expect(exported.has("parseYamlText")).toBe(false);
    expect(exported.has("readText")).toBe(false);
  });
});

const indexPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));

interface BarrelExports {
  readonly values: readonly string[];
  readonly types: readonly string[];
  // `export * from "…"` の相手モジュール。名前を列挙できない再輸出なので、あってはならない。
  readonly starExports: readonly string[];
  // 解析器が読み方を知らなかった export 文(構文名と行番号)。黙って無視すると公開面が増えても気づけない。
  readonly unsupported: readonly string[];
}

// index.ts を TypeScript の AST で読み、公開している名前を値と型に分ける。
//
// 正規表現で読むと `export { type Foo }` を値と取り違え、コメントアウトされた export 行を公開と数えるため、
// 公開集合の増減を正確に検知できない。ここは構文として読む。
//
// **知らない構文は黙って捨てない。** 読めなかった export 文は `unsupported` に積んでテストを落とす。
// 未知の構文を無視すると「公開されていない」と同じ結果になり、しかも型の直接宣言(`export interface X`)や
// `export type * as NS from "…"` は実行時に見えないので、値側の突き合わせにも引っかからずに公開面が増える。
function readBarrelExports(): BarrelExports {
  return parseExports(readFileSync(indexPath, "utf8"));
}

// 解析の本体。バレル以外(下の解析器テストが食わせるサンプル)にも当てられるように、読み込みと分けてある。
function parseExports(source: string): BarrelExports {
  const sourceFile = ts.createSourceFile(indexPath, source, ts.ScriptTarget.Latest, true);
  const values: string[] = [];
  const types: string[] = [];
  const starExports: string[] = [];
  const unsupported: string[] = [];

  const describeStatement = (statement: ts.Statement): string => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile));

    return `${ts.SyntaxKind[statement.kind]} (line ${line + 1})`;
  };

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;

      if (clause === undefined) {
        // `export * from "…"`
        starExports.push(statement.moduleSpecifier?.getText(sourceFile) ?? "(unknown module)");
        continue;
      }

      if (ts.isNamespaceExport(clause)) {
        // `export * as NS from "…"` / `export type * as NS from "…"`。公開されるのは NS という1つの名前。
        (statement.isTypeOnly ? types : values).push(clause.name.text);
        continue;
      }

      if (ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          // 宣言全体が `export type` か、要素が `type X` かのどちらかなら型。
          const target = statement.isTypeOnly || element.isTypeOnly ? types : values;

          target.push(element.name.text);
        }

        continue;
      }

      unsupported.push(describeStatement(statement));
      continue;
    }

    // `export default …` / `export = …`。バレルでは使わない(名前でなく既定値として公開されるため)。
    if (ts.isExportAssignment(statement)) {
      unsupported.push(describeStatement(statement));
      continue;
    }

    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      // import 文と、公開しないトップレベル宣言。どちらも公開面には関係しない。
      continue;
    }

    if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
      unsupported.push(describeStatement(statement));
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          values.push(declaration.name.text);
        }
      }

      continue;
    }

    // index.ts で直接宣言した型。いまバレルは再輸出だけで書かれているが、書けてしまう以上は数える。
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      types.push(statement.name.text);
      continue;
    }

    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (statement.name === undefined) {
        unsupported.push(describeStatement(statement));
      } else {
        values.push(statement.name.text);
      }

      continue;
    }

    if (ts.isEnumDeclaration(statement)) {
      values.push(statement.name.text);
      continue;
    }

    // `export namespace X {}` など。値と型のどちらとして公開されるかが中身次第なので、
    // 数え方を決めずに落とす(使うことにしたら、そのとき解析器を足す)。
    unsupported.push(describeStatement(statement));
  }

  return { values: values.sort(), types: types.sort(), starExports, unsupported };
}

function hasModifier(statement: ts.Statement, kind: ts.SyntaxKind): boolean {
  if (!ts.canHaveModifiers(statement)) {
    return false;
  }

  return (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === kind);
}

const publicValues = [
  "CONSTRAINT_PAYLOAD_SCHEMA_ID",
  "CONTENTS_ATTRIBUTE",
  "addPartToProject",
  "addPrototypeNote",
  "armRaiseFittedArmholeRule",
  "armRaiseSuggestionRule",
  "assembleConstraintPayload",
  "basicEaseFitRule",
  "buildPairSeamRequest",
  "buildProject",
  "checkPathExistence",
  "checkValSourceExists",
  "classifyAccessError",
  "cliDiagnosticCodes",
  "collectCollidingPieceNames",
  "collectEdgeOccurrencesFromValText",
  "collectExistingJoins",
  "collectProjectReadinessDiagnostics",
  "combineJoins",
  "connectBand",
  "connectParts",
  "connectorLengthRule",
  "connectorPairingRule",
  "connectorSchema",
  "constraintPayloadJsonSchema",
  "constraintPayloadSchema",
  "coreDiagnosticCodes",
  "corePackageName",
  "createBuildReport",
  "createCheckReport",
  "createCompatibilityResult",
  "createCompatibilityRuleRegistry",
  "createDiagnostic",
  "createDiagnosticReport",
  "createDoctorReport",
  "createFitReport",
  "createFitRuleRegistry",
  "createMovementTestReport",
  "createMovementTestRuleRegistry",
  "createProject",
  "createSeamlintGeometryRequest",
  "createTestSuggestionReport",
  "createTestSuggestionRuleRegistry",
  "dartSchema",
  "defaultCompatibilityRules",
  "defaultFitRules",
  "defaultMovementTestRules",
  "defaultTestSuggestionRules",
  "describeFsError",
  "diagnosticCodes",
  "diagnosticSeverities",
  "diffParts",
  "diffValSources",
  "extendJoin",
  "extractOccurrencesFromValText",
  "findCollidingRoleNames",
  "findProjectRoot",
  "findStalePartFileCopies",
  "findUnregisteredValSources",
  "flattenDetectedPieces",
  "forkProject",
  "getErrno",
  "getStatusForDiagnostics",
  "isCaseInsensitiveFileSystemAt",
  "isPathWithin",
  "isSafePathSegment",
  "listValDetailsFromFile",
  "listValDetailsFromText",
  "loadPartFile",
  "loadProfileFile",
  "loadProject",
  "loadProjectFile",
  "loadProjectedPart",
  "loadProjectedPartWithSource",
  "loadPrototypeNotesFile",
  "materializeSeamlintGeometry",
  "notchSchema",
  "notchTypeFromPassmarkLine",
  "parseSeamlintGeometryReport",
  "partSchema",
  "partStatusSchema",
  "profileMeasurementsSchema",
  "profileSchema",
  "projectDartsFromValFile",
  "projectDartsFromValText",
  "projectNotchesFromValFile",
  "projectNotchesFromValText",
  "projectPartDartsFromSource",
  "projectPartNotchesFromSource",
  "projectSchema",
  "projectTestSuiteSuggestionRule",
  "prototypeNoteMovementTestRule",
  "prototypeNoteSuggestionRule",
  "prototypeNotesSchema",
  "readIncrementsFromValFile",
  "readIncrementsFromValText",
  "readValSource",
  "requirementRangeRule",
  "requirementSchema",
  "resolveBandShape",
  "resolvePartFilePath",
  "resolveParts",
  "resolveProjectPaths",
  "runChecks",
  "runCompatibilityRules",
  "runFit",
  "runFitRules",
  "runMovementTest",
  "runMovementTestRules",
  "runTestSuggestionRules",
  "suggestJoinId",
  "suggestTests",
  "writeFileAtomic"
];

const publicTypes = [
  "AddPartConnectorInput",
  "AddPartToProjectOptions",
  "AddPrototypeNoteInput",
  "AddPrototypeNoteLeftoverFabricInput",
  "AddedPart",
  "AddedPrototypeNote",
  "BandShape",
  "BuildAssetKind",
  "BuildManifest",
  "BuildManifestAsset",
  "BuildReport",
  "CheckReport",
  "CliDiagnosticCode",
  "CompatibilityResult",
  "CompatibilityRule",
  "CompatibilityRuleRegistry",
  "ConnectBandOptions",
  "ConnectPartsOptions",
  "ConnectedBand",
  "ConnectedParts",
  "ConnectedSide",
  "ConnectionRisk",
  "Connector",
  "ConstraintConnectorRef",
  "ConstraintParam",
  "ConstraintPart",
  "ConstraintPayload",
  "ConstraintPayloadConnector",
  "ConstraintPayloadPart",
  "ConstraintPayloadResult",
  "CopiedFileField",
  "CoreDiagnosticCode",
  "CreateProjectOptions",
  "CreatedProject",
  "CustomDiagnosticCode",
  "Dart",
  "DetectedPiece",
  "Diagnostic",
  "DiagnosticCode",
  "DiagnosticReport",
  "DiagnosticSeverity",
  "DoctorFinding",
  "DoctorReport",
  "EdgeNotch",
  "EdgeOccurrenceResult",
  "ExclusiveRuleOptions",
  "ExistingJoin",
  "ExtendJoinOptions",
  "ExtendedJoin",
  "FitMeasurementResult",
  "FitReport",
  "FitRule",
  "FitRuleRegistry",
  "ForkProjectOptions",
  "ForkedProject",
  "FsErrorContext",
  "JoinSide",
  "JoinSideSize",
  "LoadFileResult",
  "LoadedProject",
  "MovementTestCheck",
  "MovementTestCheckSource",
  "MovementTestReport",
  "MovementTestRule",
  "MovementTestRuleContext",
  "MovementTestRuleRegistry",
  "Notch",
  "NotchType",
  "OccurrenceLinearity",
  "PairSeamRequestResult",
  "Part",
  "PartDiffChange",
  "PartDiffConnectorRecheckHint",
  "PartDiffConnectorRecheckKind",
  "PartDiffDecisionSummary",
  "PartDiffFieldChange",
  "PartDiffPrototypeNoteMatch",
  "PartDiffPrototypeNoteReason",
  "PartDiffRecheckHints",
  "PartDiffReport",
  "PartDiffStatus",
  "PartStatus",
  "PathExistence",
  "Profile",
  "ProfileMeasurements",
  "Project",
  "ProjectedPartLoad",
  "ProjectedPartSource",
  "PrototypeNote",
  "PrototypeNoteSignal",
  "PrototypeNotes",
  "RegisteredDiagnostic",
  "RegisteredDiagnosticCode",
  "ReportStatus",
  "Requirement",
  "ResolvedProject",
  "ResolvedProjectPart",
  "ResolvedProjectPaths",
  "RunChecksOptions",
  "RunFitOptions",
  "RunMovementTestOptions",
  "SeamlintGeometryCheckRange",
  "SeamlintGeometryCheckReport",
  "SeamlintGeometryCheckRequest",
  "SeamlintGeometryCheckSpec",
  "SeamlintGeometryDiagnostic",
  "SeamlintGeometryEdgeSignature",
  "SeamlintGeometryMarkerRange",
  "SeamlintGeometryMarkerRef",
  "SeamlintGeometryPartRef",
  "SeamlintGeometryReportStatus",
  "SeamlintGeometryRequestBuildResult",
  "SeamlintGeometryRequestReport",
  "SeamlintGeometrySourceFormat",
  "SeamlintGeometryTarget",
  "SeamlintGeometryTolerance",
  "SeamlintJoinKind",
  "SeamlintMaterializeResult",
  "SilhouetteImpact",
  "SplineHandle",
  "StalePartFileCopy",
  "StalePartFileCopyScan",
  "SuggestTestsOptions",
  "TestSuggestion",
  "TestSuggestionCandidate",
  "TestSuggestionLevel",
  "TestSuggestionReport",
  "TestSuggestionRule",
  "TestSuggestionRuleContext",
  "TestSuggestionRuleRegistry",
  "TestSuggestionSource",
  "UnregisteredValSource",
  "ValDetailList",
  "ValDrawDetails",
  "ValDrawOccurrences",
  "ValIncrement",
  "ValIncrementsReadResult",
  "ValOccurrence",
  "ValSourceChange",
  "ValSourceChangedField",
  "ValSourceDiffSummary",
  "ValSourceReadResult",
  "ValSourceReadStatus",
  "ValentinaDartProjectionResult",
  "ValentinaNotchProjectionResult",
  "VolumeChange"
];
