// **Loomit 自身が発行する**診断コードの正本。`Diagnostic.code` は report JSON にそのまま出るため、
// CLI・VSCode 拡張・CI・Seamlint / Truer が読む「語彙」であり、公開契約の一部である。
//
// ここが report JSON の code の全部ではない(下の diagnosticCodes のコメントを参照):
// Seamlint が返した diagnostics は Seamlint の語彙のまま通り抜けるし、注入された rule は
// CustomDiagnosticCode を出せる。ここが定義するのは Loomit 自身の語彙。
//
// 一覧にしている理由は3つ:
//
// 1. **改名を型で捕まえる。** 以前は 100 個以上の裸のリテラルが各モジュールに散っており、
//    doctorReport が `diagnostic.code === "CONNECTOR_JOIN_OPEN"` のように**モジュール境界を越えた
//    文字列比較**で発行元と繋がっていた。発行側の綴りを変えても型エラーが出ず、doctor が黙って
//    説明をやめる事故が起こり得た。union 型にすると、union に無いリテラルとの `===` は TS2367 に
//    なるため、この暗黙のリンクがコンパイラに見えるようになる。
// 2. **綴り間違いを弾く。** Loomit 自身の診断を足すときは、まずここに追記しないとコンパイルが通らない。
// 3. **Loomit の語彙を一箇所で数えられる。** docs 生成や棚卸しがここを読めば済む(他ツール由来と
//    拡張コードは対象外なので、「report に出る code 全部」を数えたいときはここだけでは足りない)。
//
// 追加するときの規約(`.claude/skills/loomit-implementation/references/testing-diagnostics.md`):
// - 大文字スネークケース。英語。ローカライズ差を code に混ぜない。
// - `code` は安定契約。**改名は breaking change** として扱う(consumer の分岐が壊れる)。
//   綴りが気に入らないだけの改名はしない。
// - 発行元のモジュールに対応するグループへ、アルファベット順で足す。

// core が発行する診断コード。発行元モジュールごとにグループ分けする。
export const coreDiagnosticCodes = [
  // build/
  "BUILD_INPUT_ESCAPES_PROJECT",
  "BUILD_INPUT_FILE_MISSING",
  "BUILD_INPUT_UNREADABLE",
  // NOTE: BUILD_OUTPUT_ESCAPES_ROOT と BUILD_OUTPUT_PATH_ESCAPES_ROOT は近い条件を指しており、
  // 名前だけ見ると重複に見える。前者は outputs.dir 自体が root の外、後者は個別の出力パスが root の外で、
  // 別の事象。統合するなら consumer 側の分岐を壊すので breaking change として別途扱う。
  "BUILD_OUTPUT_ESCAPES_ROOT",
  "BUILD_OUTPUT_PATH_ESCAPES_ROOT",
  "BUILD_WRITE_FAILED",

  // compatibility/ — loom check の互換ルールが出す。
  "CONNECTOR_JOIN_OPEN",
  "CONNECTOR_JOIN_SIDES_INCOMPLETE",
  "CONNECTOR_JOIN_TOO_MANY_SIDES",
  "CONNECTOR_LENGTH_MISMATCH",
  "CONNECTOR_LENGTH_UNMEASURED",
  "CONNECTOR_MISSING",
  "CONNECTOR_UNIT_DISCONNECTED",
  "REQUIREMENT_PROPERTY_UNSUPPORTED",
  "REQUIREMENT_RANGE_UNSATISFIED",
  "REQUIREMENT_TARGET_INVALID",
  "REQUIREMENT_TARGET_MISSING",

  // diff/
  "PART_DIFF_NAME_CHANGED",
  "PART_DIFF_TYPE_CHANGED",

  // filesystem/
  "FILE_READ_FAILED",

  // fit/
  "FIT_EASE_LOW",
  "FIT_EASE_NEGATIVE",

  // movement-tests/
  "ARM_RAISE_FITTED_ARMHOLE_RISK",
  "MOVEMENT_TEST_PROTOTYPE_NOTE_RISK",
  "MOVEMENT_TEST_UNSUPPORTED",

  // parts/ — loom connect(縫い合わせ宣言の書き込み)
  "CONNECT_BAND_DUPLICATE_ROLE",
  "CONNECT_BAND_NO_NEIGHBOURS",
  "CONNECT_BAND_SIDE_CONFLICT",
  "CONNECT_ID_ALREADY_DECLARED",
  "CONNECT_ID_INVALID",
  "CONNECT_ROLE_NOT_FOUND",
  "CONNECT_ROLLBACK_FAILED",
  "CONNECT_SAME_FILE",
  "CONNECT_SAME_ROLE",
  "CONNECT_SCHEMA_INVALID",
  "CONNECT_WRITE_FAILED",

  // parts/ — loom add(.val の part 登録)
  "PART_ADD_ALREADY_REGISTERED",
  "PART_ADD_DIRECTORY_EXISTS",
  "PART_ADD_DIRECTORY_UNREADABLE",
  "PART_ADD_FAILED",
  "PART_ADD_SCHEMA_INVALID",
  "PART_ADD_SEGMENT_INVALID",
  "PART_ADD_SOURCE_ESCAPES_PROJECT",
  "PART_ADD_SOURCE_NOT_A_FILE",
  "PART_ADD_SOURCE_NOT_FOUND",
  "PART_ADD_SOURCE_TARGET_CONFLICT",
  "PART_ADD_SOURCE_TARGET_UNREADABLE",
  "PART_ADD_SOURCE_UNREADABLE",
  "PART_ADD_TARGET_ESCAPES_ROOT",

  // parts/ — .val からの射影(dart / notch / piece scope)
  "PART_SOURCE_VAL_CALCULATION_MISSING",
  "PART_SOURCE_VAL_DART_UNSUPPORTED",
  "PART_SOURCE_VAL_DUPLICATE_PIECE",
  "PART_SOURCE_VAL_NOTCH_DUPLICATE_PIECE",
  "PART_SOURCE_VAL_NOTCH_UNSUPPORTED",
  "PART_SOURCE_VAL_PIECE_NOT_FOUND",
  "PART_SOURCE_VAL_PIECE_UNDECLARED",
  "PART_SOURCE_VAL_READ_FAILED",

  // project/
  "PART_FILE_COMPARE_READ_FAILED",
  "PART_FILE_COPY_STALE",
  "PART_GEOMETRY_FRESHNESS_READ_FAILED",
  "PART_GEOMETRY_STALE",
  "PROJECT_ALREADY_EXISTS",
  "PROJECT_CREATE_FAILED",
  "PROJECT_FORK_FAILED",
  "PROJECT_FORK_TARGET_INSIDE_SOURCE",
  "PROJECT_FORK_TARGET_UNREADABLE",
  "PROJECT_HAS_NO_PARTS",
  "PROJECT_ROOT_ACCESS_FAILED",
  "PROJECT_ROOT_NOT_FOUND",
  "PROJECT_TARGET_UNREADABLE",
  "UNREGISTERED_VAL_SOURCE",
  "VAL_SOURCE_READ_FAILED",
  "VAL_SOURCE_SCAN_FAILED",

  // prototype-notes/
  "PROTOTYPE_NOTES_UNREADABLE",
  "PROTOTYPE_NOTE_ADD_FAILED",
  "PROTOTYPE_NOTE_ADD_SCHEMA_INVALID",

  // seamlint/ — Seamlint への geometry request を組み立てる段階で出す。
  // 「測定した結果」ではなく「測定を依頼できない理由」であることに注意(測定結果は Seamlint 側の report)。
  "SEAMLINT_BAND_SEAM_REQUIRES_DXF",
  "SEAMLINT_CONNECTOR_JOIN_OPEN",
  "SEAMLINT_CONNECTOR_JOIN_SIDES_INCOMPLETE",
  "SEAMLINT_CONNECTOR_JOIN_TOO_MANY_SIDES",
  "SEAMLINT_CONNECTOR_LEFT_UNCHECKED",
  "SEAMLINT_CONNECTOR_NOTCH_COUNT_MISMATCH",
  "SEAMLINT_CONNECTOR_PATH_REF_MISSING",
  "SEAMLINT_CONNECTOR_RANGE_ALLOWANCE_MISMATCH",
  "SEAMLINT_CONNECTOR_RANGE_BEHAVIOR_MISMATCH",
  "SEAMLINT_CONNECTOR_RANGE_BEHAVIOR_UNSUPPORTED",
  "SEAMLINT_CONNECTOR_RANGE_EASE_RATIO_MISMATCH",
  "SEAMLINT_CONNECTOR_RANGE_EASE_SUBRANGE_UNSUPPORTED",
  "SEAMLINT_CONNECTOR_RANGE_MATCH_MISSING",
  "SEAMLINT_CONNECTOR_SEAM_DEFERRED",
  "SEAMLINT_CONNECTOR_TYPE_MISMATCH",
  "SEAMLINT_EASE_RATIO_UNRESOLVED",
  "SEAMLINT_GATHER_DIRECTION_UNRESOLVED",
  "SEAMLINT_GEOMETRY_SOURCE_FILE_MISSING",
  "SEAMLINT_GEOMETRY_SOURCE_MISSING",
  "SEAMLINT_GEOMETRY_SOURCE_UNREADABLE",
  "SEAMLINT_UNSAFE_JOIN_IDENTIFIER",

  // truer/
  "PART_CONSTRAINT_INCREMENT_CONFLICT",

  // YAML parse / schema 検証。parseYamlText と validateSchema に `invalidCode` として渡されるため、
  // `code:` を grep しても出てこない。呼び出し側(loadPartFile / loadProfile / loadProjectFile /
  // loadPrototypeNotes)がファイル種別ごとに指定する。
  "PART_SCHEMA_INVALID",
  "PART_YAML_INVALID",
  "PROFILE_SCHEMA_INVALID",
  "PROFILE_YAML_INVALID",
  "PROJECT_SCHEMA_INVALID",
  "PROJECT_YAML_INVALID",
  "PROTOTYPE_NOTES_SCHEMA_INVALID",
  "PROTOTYPE_NOTES_YAML_INVALID"
] as const;

// CLI 層が発行する診断コード。
//
// 発行元は CLI だが、正本をここ(core)に置くのは、`--format json` の消費者から見れば core 発行か
// CLI 発行かの区別が無く、**語彙は1つ**であるべきだから。core が CLI に依存するわけではない
// (ここにあるのは名前だけで、発行ロジックは CLI 側にある)。
//
// このグループに入るのは、core が構造的に持ち得ない関心に限る:
// - 外部ツール(slnt / tru)の subprocess 起動と、その出力の解釈。core は subprocess を起動しない。
// - CLI 引数として渡されたパスの解決失敗。core は「解決済みの project」を受け取る。
export const cliDiagnosticCodes = [
  // commands/match.ts
  "MATCH_NO_SEAM",
  "MATCH_PROPOSAL_DIR_FAILED",
  "MATCH_REFERENCE_BLOCK_UNRESOLVED",
  "MATCH_REFERENCE_NEEDS_DXF",
  "MATCH_ROLE_NOT_FOUND",
  "MATCH_SAME_ROLE",

  // commands/diff.ts — CLI 引数のパス解決
  "PROJECT_PART_ROLE_NOT_FOUND",
  "PROJECT_PATH_ACCESS_FAILED",
  "PROJECT_PATH_NOT_FOUND",

  // 外部ツールの起動・出力解釈。core/seamlint の SEAMLINT_* が「依頼を組み立てられない理由」なのに対し、
  // こちらは「依頼は組めたが実行できなかった/読めなかった」という別の層の失敗。
  "SEAMLINT_BAD_OUTPUT",
  "SEAMLINT_NOT_FOUND",
  "SEAMLINT_SPAWN_FAILED",
  "TRUER_FAILED",
  "TRUER_NOT_FOUND",
  "TRUER_SPAWN_FAILED"
] as const;

// **Loomit 自身が発行する**診断コードの全体。docs 生成や棚卸しはこれを読む。
//
// report JSON に出るコードの全部ではないことに注意:
// - Seamlint が返した report の diagnostics は Seamlint 側の語彙で、`loom slnt check --format json`
//   にそのまま入るが、ここには登録されない(他ツールの語彙を Loomit が固定しない)。
//   その型は seamlint/geometryReport.ts の SeamlintGeometryDiagnostic で、code は string のまま。
// - 注入された rule が出す CustomDiagnosticCode(下記)も、定義上ここには載らない。
export const diagnosticCodes = [...coreDiagnosticCodes, ...cliDiagnosticCodes] as const;

export type CoreDiagnosticCode = (typeof coreDiagnosticCodes)[number];
export type CliDiagnosticCode = (typeof cliDiagnosticCodes)[number];

// このレジストリに載っているコード = Loomit 自身が発行してよい語彙。`createDiagnostic` の入力型がこれで、
// Loomit 側の発行経路(109 箇所)は全部そこを通るため、本体が未登録のコードを出すことは型で防がれる。
export type RegisteredDiagnosticCode = CoreDiagnosticCode | CliDiagnosticCode;

// 注入された rule 用の拡張コード。`runFit(project, profile, { rules })` のように rule を差し替える経路は
// 公開 API(FitRule / MovementTestRule / CompatibilityRule は index.ts から export 済み)なので、
// 呼び出し側は Loomit の語彙に無い診断も出せる必要がある。
// (TestSuggestionRule はここに含めない ── TestSuggestion に diagnostics が無く、診断を発行しないため。)
//
// `X_` 接頭辞を要求するのは、拡張点を開けつつ綴り間違いのガードを残すため。既知コードのタイプミス
// (例: "CONNECTOR_MISSNG")は `X_` で始まらないので今までどおり型エラーになり、拡張コードだけが通る。
// 接頭辞があることで、report を読む側も「Loomit の語彙か、誰かの rule 由来か」を見分けられる。
//
// これは **Loomit 本体の逃げ道ではない**。`Diagnostic.code` が広いのは、注入された rule が組み立てた
// Diagnostic を report に載せられるようにするためで、本体の発行は上の RegisteredDiagnosticCode に閉じる。
export type CustomDiagnosticCode = `X_${string}`;

export type DiagnosticCode = RegisteredDiagnosticCode | CustomDiagnosticCode;
