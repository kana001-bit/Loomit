// @loomit/core の公開面。
//
// ここに出したシンボルは「消費者に対する契約」になる。外す・改名するのは破壊的変更として扱い、
// 逆にここに出ていないモジュール内部のヘルパは自由に作り替えてよい。その線引きを表すのがこのファイル。
//
// 何を出すか。次のどれかに当たるものだけを出す。
//   - コマンドが呼ぶ操作と、その戻り値の型
//   - report / diagnostic の形(`--format json` を読む側が参照する)
//   - 呼び出し側が注入できる rule(docs/architecture.md「rule は呼び出し側から注入できる」)
//   - schema とドメイン型(ファイル形式そのものの契約)
//   - Seamlint / Truer との cross-repo 契約
// 読み取りの下請けのような内部専用ヘルパは、CLI から使えても出さない。
//
// 型が「誰にも使われていない」ことは、出さない理由にならない。`PartDiffChange` のような型は
// `PartDiffReport` の中身なので、落とすと読み手が `PartDiffReport["changes"][number]` と書く羽目になる。
// 名前で呼べること自体が契約の一部。
//
// 公開集合は packages/core/test/public-api.test.ts が一覧で固定している。export を足す/外すときは
// その一覧も更新する(通るまで気づかない、が起きないように)。
export const corePackageName = "@loomit/core";

// --- プロジェクト操作 -------------------------------------------------------
// project / part の作成・読み込み・書き込みと、build の出力集約。CLI コマンドの入口になる操作。
export { createProject } from "./project/createProject.js";
export type { CreatedProject, CreateProjectOptions } from "./project/createProject.js";
export { findProjectRoot } from "./project/findProjectRoot.js";
export { forkProject } from "./project/forkProject.js";
export type { ForkedProject, ForkProjectOptions } from "./project/forkProject.js";
export { loadProject } from "./project/loadProject.js";
export type { LoadedProject } from "./project/loadProject.js";
export { loadProjectFile } from "./project/loadProjectFile.js";
export { resolveParts } from "./project/resolveParts.js";
export type { ResolvedProject, ResolvedProjectPart } from "./project/resolveParts.js";
export { resolveProjectPaths } from "./project/resolveProjectPaths.js";
export type { ResolvedProjectPaths } from "./project/resolveProjectPaths.js";
export { collectProjectReadinessDiagnostics } from "./project/collectProjectReadiness.js";
export { findStalePartFileCopies } from "./project/findStalePartFileCopies.js";
export type {
  CopiedFileField,
  StalePartFileCopy,
  StalePartFileCopyScan
} from "./project/findStalePartFileCopies.js";
export { findUnregisteredValSources } from "./project/findUnregisteredValSources.js";
export type { UnregisteredValSource } from "./project/findUnregisteredValSources.js";
export { addPartToProject, checkValSourceExists } from "./parts/addPartToProject.js";
export type {
  AddedPart,
  AddPartConnectorInput,
  AddPartToProjectOptions
} from "./parts/addPartToProject.js";
export { connectBand, connectParts, extendJoin } from "./parts/connectParts.js";
export type {
  ConnectBandOptions,
  ConnectedBand,
  ConnectedParts,
  ConnectedSide,
  ConnectPartsOptions,
  ExtendedJoin,
  ExtendJoinOptions
} from "./parts/connectParts.js";
export { loadPartFile } from "./parts/loadPartFile.js";
export { loadProjectedPart, loadProjectedPartWithSource } from "./parts/loadProjectedPart.js";
export type { ProjectedPartLoad, ProjectedPartSource } from "./parts/loadProjectedPart.js";
export { resolvePartFilePath } from "./parts/resolvePartFilePath.js";
export { loadProfileFile } from "./profile/loadProfile.js";
export { loadPrototypeNotesFile } from "./prototype-notes/loadPrototypeNotes.js";
export { addPrototypeNote } from "./prototype-notes/addPrototypeNote.js";
export type {
  AddPrototypeNoteInput,
  AddPrototypeNoteLeftoverFabricInput,
  AddedPrototypeNote
} from "./prototype-notes/addPrototypeNote.js";
export { buildProject, createBuildReport } from "./build/buildProject.js";

// --- authoring の判断(何を書くかを決めるまで) -------------------------------
// 上の addPartToProject / connectParts は「書く」操作で、その手前には「何を書くか」を決めるドメイン規則が
// ある。role 名がぶつからないか、どの join(縫い合わせ先)に繋げるか、新しい縫い目にどの id を付けるか。
// これらは対話 UI でも GUI でも同じ答えを出すべきものなので、CLI のウィザードに埋めず操作として公開する。
// 呼び出し側が持つのは訊き方と見せ方だけになる。
export { collectCollidingPieceNames, findCollidingRoleNames } from "./parts/roleCollisions.js";
export { collectExistingJoins, combineJoins, suggestJoinId } from "./parts/joinInventory.js";
export type { ExistingJoin, JoinSide } from "./parts/joinInventory.js";
// band 形の判定は authoring(どの側に足してよいか)と幾何 request の生成(band-seam を出すか)の両方が
// 同じ問いを解くので、規則を1つだけ公開する。呼び出し側が独自に「1枚の側が band」を書き直さないため。
export { resolveBandShape } from "./schema/connectorSides.js";
export type { BandShape, JoinSideSize } from "./schema/connectorSides.js";
export type {
  BuildAssetKind,
  BuildManifest,
  BuildManifestAsset,
  BuildReport
} from "./build/buildProject.js";

// --- チェックの実行とレポート -----------------------------------------------
// loom check / fit / movement-test / diff の実行と、その結果の形。
// report のフィールドは `--format json` の契約でもあるので、改名は破壊的変更として扱う。
export { runChecks } from "./compatibility/runChecks.js";
export type { RunChecksOptions } from "./compatibility/runChecks.js";
export { createCheckReport, createCompatibilityResult } from "./compatibility/checkReport.js";
export type { CheckReport, CompatibilityResult } from "./compatibility/checkReport.js";
export { runFit } from "./fit/runFit.js";
export type { RunFitOptions } from "./fit/runFit.js";
export { createFitReport } from "./fit/fitReport.js";
export type { FitMeasurementResult, FitReport } from "./fit/fitReport.js";
export { createMovementTestReport, runMovementTest } from "./movement-tests/runMovementTest.js";
export type { RunMovementTestOptions } from "./movement-tests/runMovementTest.js";
export type {
  MovementTestCheck,
  MovementTestCheckSource,
  MovementTestReport
} from "./movement-tests/runMovementTest.js";
export { createTestSuggestionReport, suggestTests } from "./movement-tests/suggestTests.js";
export type { SuggestTestsOptions } from "./movement-tests/suggestTests.js";
export type {
  TestSuggestion,
  TestSuggestionLevel,
  TestSuggestionReport,
  TestSuggestionSource
} from "./movement-tests/suggestTests.js";
export { diffParts } from "./diff/partDiff.js";
export type {
  ConnectionRisk,
  PartDiffChange,
  PartDiffConnectorRecheckHint,
  PartDiffConnectorRecheckKind,
  PartDiffDecisionSummary,
  PartDiffFieldChange,
  PartDiffPrototypeNoteMatch,
  PartDiffPrototypeNoteReason,
  PartDiffRecheckHints,
  PartDiffReport,
  PartDiffStatus,
  PrototypeNoteSignal,
  SilhouetteImpact,
  VolumeChange
} from "./diff/partDiff.js";
export { CONTENTS_ATTRIBUTE, diffValSources } from "./diff/valSourceDiff.js";
export type {
  ValSourceChange,
  ValSourceChangedField,
  ValSourceDiffSummary
} from "./diff/valSourceDiff.js";
export { cliDiagnosticCodes, coreDiagnosticCodes, diagnosticCodes } from "./diagnostics/codes.js";
export type {
  CliDiagnosticCode,
  CoreDiagnosticCode,
  CustomDiagnosticCode,
  DiagnosticCode,
  RegisteredDiagnosticCode
} from "./diagnostics/codes.js";
export { createDiagnostic, diagnosticSeverities } from "./diagnostics/diagnostic.js";
export type {
  Diagnostic,
  DiagnosticSeverity,
  RegisteredDiagnostic
} from "./diagnostics/diagnostic.js";
export { createDiagnosticReport, getStatusForDiagnostics } from "./diagnostics/report.js";
export type { DiagnosticReport, ReportStatus } from "./diagnostics/report.js";
export { createDoctorReport } from "./diagnostics/doctorReport.js";
export type { DoctorFinding, DoctorReport } from "./diagnostics/doctorReport.js";

// --- rule の注入点 ----------------------------------------------------------
// docs/architecture.md:「rule は呼び出し側から注入できる(`runFit(project, profile, { rules })`)。
// 注入された rule は X_ 接頭辞の拡張コードを発行できる。外部 plugin runtime は持たない。」
//
// いま CLI は既定の rule のまま使っているので、この面は「まだ誰も使っていないが約束している」面になる。
// 未使用を理由に外すと、上の設計判断を黙って撤回することになるため、外すなら docs を先に直す。
export type { ExclusiveRuleOptions } from "./ruleOptions.js";
export {
  connectorLengthRule,
  connectorPairingRule,
  createCompatibilityRuleRegistry,
  defaultCompatibilityRules,
  requirementRangeRule,
  runCompatibilityRules
} from "./compatibility/rules.js";
export type { CompatibilityRule, CompatibilityRuleRegistry } from "./compatibility/rules.js";
export {
  basicEaseFitRule,
  createFitRuleRegistry,
  defaultFitRules,
  runFitRules
} from "./fit/rules.js";
export type { FitRule, FitRuleRegistry } from "./fit/rules.js";
export {
  armRaiseFittedArmholeRule,
  createMovementTestRuleRegistry,
  defaultMovementTestRules,
  prototypeNoteMovementTestRule,
  runMovementTestRules
} from "./movement-tests/rules.js";
export type {
  MovementTestRule,
  MovementTestRuleContext,
  MovementTestRuleRegistry
} from "./movement-tests/rules.js";
export {
  armRaiseSuggestionRule,
  createTestSuggestionRuleRegistry,
  defaultTestSuggestionRules,
  projectTestSuiteSuggestionRule,
  prototypeNoteSuggestionRule,
  runTestSuggestionRules
} from "./movement-tests/suggestionRules.js";
export type {
  TestSuggestionCandidate,
  TestSuggestionRule,
  TestSuggestionRuleContext,
  TestSuggestionRuleRegistry
} from "./movement-tests/suggestionRules.js";

// --- `.val` の射影 ----------------------------------------------------------
// .val(Valentina) から detail / dart / notch / increment / 辺の出現を読み出す。Loomit は .val を書かない。
// File 版(パスを渡す) / Text 版(本文を渡す) / Source 版(part の files.source を辿る)が対称に並ぶ。
// 呼び出し側が何を持っているかで選べるように揃えてあるので、未使用の版だけを間引かない。
export {
  flattenDetectedPieces,
  listValDetailsFromFile,
  listValDetailsFromText
} from "./parts/listValDetails.js";
export type { DetectedPiece, ValDetailList, ValDrawDetails } from "./parts/listValDetails.js";
export {
  projectDartsFromValFile,
  projectDartsFromValText,
  projectPartDartsFromSource
} from "./parts/projectDartsFromVal.js";
export type { ValentinaDartProjectionResult } from "./parts/projectDartsFromVal.js";
export {
  projectNotchesFromValFile,
  projectNotchesFromValText,
  projectPartNotchesFromSource
} from "./parts/projectNotchesFromVal.js";
export type { ValentinaNotchProjectionResult } from "./parts/projectNotchesFromVal.js";
export {
  readIncrementsFromValFile,
  readIncrementsFromValText
} from "./parts/readIncrementsFromVal.js";
export type { ValIncrement, ValIncrementsReadResult } from "./parts/readIncrementsFromVal.js";
export { extractOccurrencesFromValText } from "./parts/extractOccurrencesFromVal.js";
export type {
  OccurrenceLinearity,
  SplineHandle,
  ValDrawOccurrences,
  ValOccurrence
} from "./parts/extractOccurrencesFromVal.js";
export { collectEdgeOccurrencesFromValText } from "./parts/collectEdgeOccurrencesFromVal.js";
export type { EdgeNotch, EdgeOccurrenceResult } from "./parts/collectEdgeOccurrencesFromVal.js";
export { notchTypeFromPassmarkLine } from "./parts/notchType.js";
export type { NotchType } from "./parts/notchType.js";
export { readValSource } from "./parts/readValSource.js";
export type { ValSourceReadResult, ValSourceReadStatus } from "./parts/readValSource.js";

// --- cross-repo 契約(Seamlint / Truer) --------------------------------------
// 別 repo が読む形。Loomit は構造と identity を渡し、幾何の計測は Seamlint、線の整形は Truer が持つ。
// ここを変えると相手側は古い契約のままビルドが通ってしまうので、変更には両 repo の合意が要る。
export { createSeamlintGeometryRequest } from "./seamlint/createGeometryRequest.js";
export type {
  SeamlintGeometryCheckRange,
  SeamlintGeometryCheckRequest,
  SeamlintGeometryCheckSpec,
  SeamlintGeometryEdgeSignature,
  SeamlintGeometryMarkerRange,
  SeamlintGeometryMarkerRef,
  SeamlintGeometryPartRef,
  SeamlintGeometryRequestBuildResult,
  SeamlintGeometrySourceFormat,
  SeamlintGeometryTarget,
  SeamlintGeometryTolerance,
  SeamlintJoinKind
} from "./seamlint/createGeometryRequest.js";
export { buildPairSeamRequest } from "./seamlint/buildPairSeamRequest.js";
export type { PairSeamRequestResult } from "./seamlint/buildPairSeamRequest.js";
export { materializeSeamlintGeometry } from "./seamlint/materializeGeometry.js";
export type { SeamlintMaterializeResult } from "./seamlint/materializeGeometry.js";
export { parseSeamlintGeometryReport } from "./seamlint/geometryReport.js";
export type {
  SeamlintGeometryCheckReport,
  SeamlintGeometryDiagnostic,
  SeamlintGeometryReportStatus,
  SeamlintGeometryRequestReport
} from "./seamlint/geometryReport.js";
export { assembleConstraintPayload } from "./truer/assembleConstraintPayload.js";
export type {
  ConstraintParam,
  ConstraintConnectorRef,
  ConstraintPart,
  ConstraintPayload,
  ConstraintPayloadConnector,
  ConstraintPayloadPart,
  ConstraintPayloadResult
} from "./truer/assembleConstraintPayload.js";
export {
  CONSTRAINT_PAYLOAD_SCHEMA_ID,
  constraintPayloadJsonSchema,
  constraintPayloadSchema
} from "./schema/constraint-payload.schema.js";

// --- schema とドメイン型 ----------------------------------------------------
// loomit.yml / part.loom / profile / prototype-notes.yml の zod schema と、そこから導出した型。
// ファイル形式そのものの契約なので、部分 schema(dartSchema 等)も名前で公開する。
export {
  connectorSchema,
  dartSchema,
  notchSchema,
  partSchema,
  partStatusSchema,
  requirementSchema
} from "./schema/part.schema.js";
export type {
  Connector,
  Dart,
  Notch,
  Part,
  PartStatus,
  Requirement
} from "./schema/part.schema.js";
export { projectSchema } from "./schema/project.schema.js";
export type { Project } from "./schema/project.schema.js";
export { profileMeasurementsSchema, profileSchema } from "./schema/profile.schema.js";
export type { Profile, ProfileMeasurements } from "./schema/profile.schema.js";
export { prototypeNotesSchema } from "./schema/prototype-notes.schema.js";
export type { PrototypeNote, PrototypeNotes } from "./schema/prototype-notes.schema.js";

// --- filesystem ヘルパ ------------------------------------------------------
// 原子的書き込み・パス封じ込め・errno 分類。CLI も引数由来のパスを扱うので、
// operational-constraints.md の R1/R2/R3 を CLI 側でも同じ実装で守れるように公開している。
// 読み取りの下請け(YAML パース・テキスト読み)は core 内部専用なので出さない。
export { describeFsError, getErrno } from "./filesystem/fsError.js";
export type { FsErrorContext } from "./filesystem/fsError.js";
export { isCaseInsensitiveFileSystemAt } from "./filesystem/caseSensitivity.js";
export { checkPathExistence, classifyAccessError } from "./filesystem/pathExists.js";
export type { PathExistence } from "./filesystem/pathExists.js";
export { isPathWithin, isSafePathSegment } from "./filesystem/pathWithin.js";
export { writeFileAtomic } from "./filesystem/writeFileAtomic.js";
export type { LoadFileResult } from "./filesystem/loadFileResult.js";
