export const corePackageName = "@loomit/core";

export { buildProject, createBuildReport } from "./build/buildProject.js";
export type {
  BuildAssetKind,
  BuildManifest,
  BuildManifestAsset,
  BuildReport
} from "./build/buildProject.js";
export { createCheckReport, createCompatibilityResult } from "./compatibility/checkReport.js";
export type { CheckReport, CompatibilityResult } from "./compatibility/checkReport.js";
export { runChecks } from "./compatibility/runChecks.js";
export type { RunChecksOptions } from "./compatibility/runChecks.js";
export {
  connectorLengthRule,
  connectorPairingRule,
  createCompatibilityRuleRegistry,
  defaultCompatibilityRules,
  requirementRangeRule,
  runCompatibilityRules
} from "./compatibility/rules.js";
export type { CompatibilityRule, CompatibilityRuleRegistry } from "./compatibility/rules.js";
export { createDiagnostic, diagnosticSeverities } from "./diagnostics/diagnostic.js";
export type { Diagnostic, DiagnosticSeverity } from "./diagnostics/diagnostic.js";
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
export { createDoctorReport } from "./diagnostics/doctorReport.js";
export type { DoctorFinding, DoctorReport } from "./diagnostics/doctorReport.js";
export { createDiagnosticReport, getStatusForDiagnostics } from "./diagnostics/report.js";
export type { DiagnosticReport, ReportStatus } from "./diagnostics/report.js";
export { createFitReport } from "./fit/fitReport.js";
export type { FitMeasurementResult, FitReport } from "./fit/fitReport.js";
export { runFit } from "./fit/runFit.js";
export type { RunFitOptions } from "./fit/runFit.js";
export {
  basicEaseFitRule,
  createFitRuleRegistry,
  defaultFitRules,
  runFitRules
} from "./fit/rules.js";
export type { FitRule, FitRuleRegistry } from "./fit/rules.js";
export { describeFsError, getErrno } from "./filesystem/fsError.js";
export type { FsErrorContext } from "./filesystem/fsError.js";
export { parseYamlText } from "./filesystem/parseYamlText.js";
export { isCaseInsensitiveFileSystemAt } from "./filesystem/caseSensitivity.js";
export { isPathWithin, isSafePathSegment } from "./filesystem/pathWithin.js";
export { readText } from "./filesystem/readText.js";
export { writeFileAtomic } from "./filesystem/writeFileAtomic.js";
export type { LoadFileResult } from "./filesystem/loadFileResult.js";
export { addLibraryPartToProject } from "./library/addLibraryPartToProject.js";
export type {
  AddedLibraryPart,
  AddLibraryPartToProjectOptions
} from "./library/addLibraryPartToProject.js";
export { listLibraryParts } from "./library/listLibraryParts.js";
export type { LibraryPartEntry, ListLibraryPartsOptions } from "./library/listLibraryParts.js";
export { loadLibraryMetaFile } from "./library/loadLibraryMeta.js";
export { publishPart } from "./library/publishPart.js";
export type { PublishedPart, PublishPartOptions } from "./library/publishPart.js";
export { createTestSuggestionReport, suggestTests } from "./movement-tests/suggestTests.js";
export type { SuggestTestsOptions } from "./movement-tests/suggestTests.js";
export type {
  TestSuggestion,
  TestSuggestionLevel,
  TestSuggestionReport,
  TestSuggestionSource
} from "./movement-tests/suggestTests.js";
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
export { createMovementTestReport, runMovementTest } from "./movement-tests/runMovementTest.js";
export type { RunMovementTestOptions } from "./movement-tests/runMovementTest.js";
export type {
  MovementTestCheck,
  MovementTestCheckSource,
  MovementTestReport
} from "./movement-tests/runMovementTest.js";
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
export { addPartToProject, checkValSourceExists } from "./parts/addPartToProject.js";
export type {
  AddedPart,
  AddPartConnectorInput,
  AddPartToProjectOptions
} from "./parts/addPartToProject.js";
export { connectBand, connectParts } from "./parts/connectParts.js";
export type {
  ConnectBandOptions,
  ConnectedBand,
  ConnectedParts,
  ConnectedSide,
  ConnectPartsOptions
} from "./parts/connectParts.js";
export { loadPartFile } from "./parts/loadPartFile.js";
export { loadProjectedPart } from "./parts/loadProjectedPart.js";
export { listValDetailsFromFile, listValDetailsFromText } from "./parts/listValDetails.js";
export type { ValDetailList, ValDrawDetails } from "./parts/listValDetails.js";
export {
  projectDartsFromValFile,
  projectDartsFromValText,
  projectPartDartsFromSource
} from "./parts/projectDartsFromVal.js";
export {
  projectNotchesFromValFile,
  projectNotchesFromValText,
  projectPartNotchesFromSource
} from "./parts/projectNotchesFromVal.js";
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
export { loadProfileFile } from "./profile/loadProfile.js";
export { loadPrototypeNotesFile } from "./prototype-notes/loadPrototypeNotes.js";
export { addPrototypeNote } from "./prototype-notes/addPrototypeNote.js";
export type {
  AddPrototypeNoteInput,
  AddPrototypeNoteLeftoverFabricInput,
  AddedPrototypeNote
} from "./prototype-notes/addPrototypeNote.js";
export { createProject } from "./project/createProject.js";
export type { CreatedProject, CreateProjectOptions } from "./project/createProject.js";
export { collectProjectReadinessDiagnostics } from "./project/collectProjectReadiness.js";
export { findUnregisteredValSources } from "./project/findUnregisteredValSources.js";
export type { UnregisteredValSource } from "./project/findUnregisteredValSources.js";
export { findProjectRoot } from "./project/findProjectRoot.js";
export { forkProject } from "./project/forkProject.js";
export type { ForkedProject, ForkProjectOptions } from "./project/forkProject.js";
export { loadProject } from "./project/loadProject.js";
export { loadProjectFile } from "./project/loadProjectFile.js";
export { resolveParts } from "./project/resolveParts.js";
export { resolveProjectPaths } from "./project/resolveProjectPaths.js";
export type { LoadedProject } from "./project/loadProject.js";
export type { ResolvedProject, ResolvedProjectPart } from "./project/resolveParts.js";
export type { ResolvedProjectPaths } from "./project/resolveProjectPaths.js";
export { createSeamlintGeometryRequest } from "./seamlint/createGeometryRequest.js";
export type {
  SeamlintGeometryCheckRange,
  SeamlintGeometryCheckRequest,
  SeamlintGeometryCheckSpec,
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
export { libraryMetaSchema, libraryPartStatusSchema } from "./schema/library-meta.schema.js";
export type { LibraryMeta, LibraryPartStatus } from "./schema/library-meta.schema.js";
export { profileMeasurementsSchema, profileSchema } from "./schema/profile.schema.js";
export type { Profile, ProfileMeasurements } from "./schema/profile.schema.js";
export { prototypeNotesSchema } from "./schema/prototype-notes.schema.js";
export type { PrototypeNote, PrototypeNotes } from "./schema/prototype-notes.schema.js";
