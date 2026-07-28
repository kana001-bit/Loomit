import { constants, type Stats } from "node:fs";
import { copyFile, mkdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { stringify } from "yaml";

import { createDiagnostic } from "../diagnostics/diagnostic.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { describeFsError } from "../filesystem/fsError.js";
import type { LoadFileResult } from "../filesystem/loadFileResult.js";
import { checkPathExistence, classifyAccessError } from "../filesystem/pathExists.js";
import { isPathWithin, isSafePathSegment } from "../filesystem/pathWithin.js";
import { toPosixPath } from "../filesystem/toPosixPath.js";
import { writeFileAtomic } from "../filesystem/writeFileAtomic.js";
import { loadProject } from "../project/loadProject.js";
import { partSchema } from "../schema/part.schema.js";
import type { Connector, Part } from "../schema/part.schema.js";
import type { Project } from "../schema/project.schema.js";

// 対話ウィザード(CLI 側)が集めた回答を受け取り、part.loom を「生成」する純粋な書き込み。ここには
// prompt を持ち込まない(core / CLI 分離: 対話は CLI、決定済みの値からの生成は core)。ユーザーは .val を
// 置くだけで part.loom を手書きしなくてよい、という設計を成立させる入口。
export interface AddPartConnectorInput {
  // record key = join id。縫い目ごとに一意な rendezvous で、check は同じ id を宣言するパーツ同士をペアにする。
  // type(種類ラベル)とは別軸: 同じ type の縫い目が複数あってよく、その区別は id が担う(id を潰すと over-pair する)。
  readonly id: string;
  // connector.type = 縫い目の種類ラベル(例: "side" / "armhole")。ペアリングには使われない分類語。
  // 省略時は id にフォールバックする(id=type だった旧来の呼び出しと、type を分けない core 直呼びとの後方互換)。
  readonly type?: string;
  // 仕上がり線上の長さ(mm)。幾何の測定値であり scaffold 時は未測定(undefined)を許す。
  // 値は .val を評価して初めて出る計算値なので、ここでは人が知っている場合だけ受け取り、
  // 無ければ後で Seamlint(loom slnt check)が実測する(connectorSchema も length_mm を optional にした)。
  readonly lengthMm?: number;
}

export interface AddPartToProjectOptions {
  // project を探す起点(通常は cwd)。ここから loomit.yml を見つけて parts に登録する。
  readonly projectPath: string;
  // 取り込む .val のパス(呼び手が cwd 基準で解決済みの絶対パスを渡す)。
  readonly valPath: string;
  // part.loom のラベル(name)。パスにもキーにも使わないので、日本語/空白を含む自由文字列でよい。
  readonly name: string;
  // project 側の part identity(front / back など)。loomit.yml の parts key かつ parts/<role>/ の
  // ディレクトリ segment になる。省略時は type を role として使う(旧来の 1 .val=1 part 経路)。
  readonly role?: string;
  // garment 上の粗分類(body / sleeve など)。role とは別軸で、同じ type のピースが複数あってよい。
  readonly type: string;
  readonly variant: string;
  // 共有 .val 内のどの <detail> ピースかを指す名前。1 .val→N part のとき各 part がこれで自分の担当を指す。
  readonly piece?: string;
  readonly connectors?: readonly AddPartConnectorInput[];
}

// 設計判断(破壊的変更の記録): かつてここに keepSource?: boolean があった。「parts/ 内から取り込んだ
// 元 .val を削除する(実質 move)」挙動を、1 .val→N part の途中ピースで抑止するためのもの。add が .val を
// コピーしなくなり元を消す理由が無くなったため、削除した。
//
// 互換のためフィールドを残して無視する案は取らなかった。旧セマンティクスは true=「消さない」/
// false(既定)=「parts/ 内なら消す」で、新実装は常に消さない。no-op 残置だと true の呼び手は偶然
// 正しく動き、false の呼び手だけが黙って挙動の変わったコードを使い続ける。削除すれば両方が
// コンパイルエラーになり、呼び手が必ず気付く ── 「静かに意味が変わる」より「うるさく壊れる」を選ぶ。
// 再追加しないこと。

export interface AddedPart {
  readonly project: Project;
  readonly part: Part;
  // loomit.yml に登録した role。project の part スロット(front / back)を表す。
  readonly role: string;
  // part.loom の name(ラベル)。
  readonly name: string;
  readonly partDirectory: string;
  readonly partFilePath: string;
  // この part が読む .val の実体パス。project 内の .val をその場参照したなら元の位置、project 外から
  // 取り込んだなら project root に置いたコピーの位置。
  readonly sourceFilePath: string;
  // sourceFilePath が「この add で新しく置いたコピー」なら true、既にあったものを参照しただけなら false。
  // CLI が成功表示で「置いた」と「参照した」を書き分けるために持つ。
  readonly sourceCopied: boolean;
  readonly projectPartPath: string;
  readonly projectFilePath: string;
}

export async function addPartToProject(
  options: AddPartToProjectOptions
): Promise<LoadFileResult<AddedPart>> {
  const loadedProjectResult = await loadProject(options.projectPath);

  if (!loadedProjectResult.ok) {
    return loadedProjectResult;
  }

  // role は project の part identity(front / back)で、loomit.yml の parts key かつ parts/<role>/ の
  // ディレクトリ segment になる。type(body / sleeve)とは別軸: 実データでは同じ type のピースが複数あり、
  // 「1 type = 1 part」だと 2 枚目が登録できなかった。role を明示できるようにして分離した(案B)。
  // role 未指定なら type を role として使う(旧来の 1 .val=1 part 経路との後方互換)。ファイルに触る前に、
  // 区切り文字や ".." を含む role(project root の外を指しうる)を弾く。
  const role = options.role ?? options.type;

  if (!isSafePathSegment(role)) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "PART_ADD_SEGMENT_INVALID",
          message: "Project part role must be a single path segment.",
          target: role,
          suggestion: ["Use a role without path separators, \"..\", or an absolute path."]
        })
      ]
    };
  }

  const { projectRoot, projectFilePath } = loadedProjectResult.value.paths;
  const valPath = resolve(options.valPath);

  const missingSource = await checkValSourceExists(valPath);

  if (missingSource !== undefined) {
    return { ok: false, diagnostics: [missingSource] };
  }

  const partDirectory = resolve(projectRoot, "parts", role);
  const partFilePath = join(partDirectory, "part.loom");
  const projectPartPath = `./parts/${role}/part.loom`;

  // .val をどこから読ませるかを決める(コピーするかどうかもここで決まる)。書き込みを始める前に確定させ、
  // 衝突(project root に別内容の同名ファイル)ならファイルに触る前に失敗させる。
  const sourcePlan = await planValSource(projectRoot, valPath);

  if (!sourcePlan.ok) {
    return { ok: false, diagnostics: sourcePlan.diagnostics };
  }

  // parts/<role>/ は project root 配下でなければならない(segment 検証済みだが二重の安全策)。
  if (!isPathWithin(projectRoot, partDirectory)) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "PART_ADD_TARGET_ESCAPES_ROOT",
          message: "The part target would write outside the project root.",
          target: partDirectory,
          suggestion: ["Use a role without path separators, \"..\", or an absolute path."]
        })
      ]
    };
  }

  // 既存 part を黙って上書きしない。role の重複、ディレクトリの既存はどちらもエラーにする。
  // project は role ごとに1つの part を持つ(resolveParts が role をキーにする)ため、同じ role の
  // 二重登録はここで弾く(type が同じでも role が違えば別 part として共存できる)。
  if (loadedProjectResult.value.project.parts[role] !== undefined) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "PART_ADD_ALREADY_REGISTERED",
          message: `Project already has a part for role "${role}".`,
          target: `parts.${role}`,
          suggestion: ["Choose another role, or edit the existing part."]
        })
      ]
    };
  }

  // access() の失敗を「無い」に潰さない。権限で存在判定できないまま書き込みに進むと誤って上書き
  // しかねないので、errno を分類して確認できないときは失敗を返す(R3)。
  const partDirectoryExistence = await checkPathExistence(partDirectory);

  if (partDirectoryExistence.kind === "inaccessible") {
    return {
      ok: false,
      diagnostics: [
        describeFsError(partDirectoryExistence.error, {
          code: "PART_ADD_DIRECTORY_UNREADABLE",
          message:
            "取り込み先の part ディレクトリが既に存在するか確認できませんでした。/ Could not determine whether a part directory already exists at the target.",
          target: partDirectory,
          suggestion: ["Check the project path and filesystem permissions."]
        })
      ]
    };
  }

  if (partDirectoryExistence.kind === "exists") {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "PART_ADD_DIRECTORY_EXISTS",
          message: "A part directory already exists at the target.",
          target: partDirectory,
          suggestion: ["Choose another role, or remove the existing part directory."]
        })
      ]
    };
  }

  const partResult = buildPart(options, sourcePlan.value.relativePath, role);

  if (!partResult.ok) {
    return partResult;
  }

  const part = partResult.value;
  const project: Project = {
    ...loadedProjectResult.value.project,
    parts: {
      ...loadedProjectResult.value.project.parts,
      [role]: projectPartPath
    }
  };

  // ロールバックで消してよいのは「この呼び出しが実際に作ったコピー」だけ。計画(sourcePlan.copy)ではなく
  // 実績で判定する ── 下の COPYFILE_EXCL が EEXIST で落ちた場合、そのファイルを作ったのは競合する
  // 別の書き手であって我々ではない。計画で判定すると、失敗のロールバックで他人のファイルを削除する。
  let copyCreatedHere = false;

  try {
    await mkdir(partDirectory, { recursive: true });

    // project 外の .val だけを project root へ取り込む。project 内の .val はその場を参照するのでコピー
    // しない。1 .val→N part でもコピーは1つだけ(2ピース目以降は同一内容の既存として参照に落ちる)。
    //
    // COPYFILE_EXCL は必須。既定の copyFile は黙って上書きするため、planValSource の存在確認とここの
    // 間にファイルが現れると(TOCTOU)ユーザーの .val を潰す。置き先が part ディレクトリ(直前に作った
    // 新規)から project root(正本が並ぶ場所)に変わったぶん、取り逃がしたときの被害が大きい。
    // 排他にしておけば競合は上書きではなく EEXIST の失敗になり、下の catch が errno 付きで報告する。
    if (sourcePlan.value.copy) {
      await copyFile(valPath, sourcePlan.value.sourceFilePath, constants.COPYFILE_EXCL);
      copyCreatedHere = true;
    }

    await writeFileAtomic(partFilePath, stringify(part));
    // loomit.yml は最後に書く。ここまでで失敗したら下の catch で巻き戻す。
    await writeFileAtomic(projectFilePath, stringify(project));
  } catch (error) {
    // 生成した part ディレクトリを巻き戻す(上のガードで実行前には存在しなかったことを確認済み)。
    // loomit.yml を参照だけ増やして実体が無い、という半端な状態を残さない。
    await rm(partDirectory, { recursive: true, force: true }).catch(() => undefined);

    // 自分で作ったコピーだけを消す。既存を参照しただけのとき、および COPYFILE_EXCL が EEXIST で
    // 落ちたとき(= 作ったのは別の書き手)は触らない。他人のファイルを巻き添えにしない。
    if (copyCreatedHere) {
      await rm(sourcePlan.value.sourceFilePath, { force: true }).catch(() => undefined);
    }

    return {
      ok: false,
      diagnostics: [
        describeFsError(error, {
          code: "PART_ADD_FAILED",
          message: "Could not add the part to the project.",
          target: partDirectory,
          suggestion: ["Check the .val path, project path, and filesystem permissions."]
        })
      ]
    };
  }

  return {
    ok: true,
    value: {
      project,
      part,
      role,
      name: options.name,
      partDirectory,
      partFilePath,
      sourceFilePath: sourcePlan.value.sourceFilePath,
      // 計画(sourcePlan.copy)ではなく実績を返す。成功パスでは一致するが、「コピーしたか」の
      // 真実を1箇所に保つ(この二重管理がロールバックで他人のファイルを消すバグを生んだ)。
      sourceCopied: copyCreatedHere,
      projectPartPath,
      projectFilePath
    },
    diagnostics: []
  };
}

interface ValSourcePlan {
  // この part が読む .val の実体パス。
  readonly sourceFilePath: string;
  // files.source に書く project root 相対パス(POSIX 区切り)。
  readonly relativePath: string;
  // この add で sourceFilePath に新しくコピーを置く必要があるか。
  readonly copy: boolean;
}

// .val をどこから読ませるかを決める。
//
// - project 内の .val: その場を参照する。コピーも move もしない(コピーを作らないのがこの設計の目的)。
// - project 外の .val(Downloads 等): schema が絶対パスと ".." を拒否するので参照できない。project root
//   に1つだけ取り込む。part ごとではなく root に置くのは、1 .val→N part で複製が増えないようにするため。
//
// project root に同名が既に在る場合、内容が同じならコピーせず参照する(N ピース add の2回目以降と、
// 同じ .val を再取り込みしたときがここに来る)。内容が違えばエラーにする ── 黙って上書きすると、
// 既に他の part が読んでいるファイルを別物に差し替えてしまう(R1: 正本を壊さない)。
//
// 内外の判定は **realpath** で行う(R2)。パス文字列だけで見ると、project 内に置いた symlink が外を
// 指していても「内側」と判定してしまい、その symlink パスを files.source に記録することになる。
// 下流(射影・Seamlint handoff・build の output コピー)は symlink を辿るので、project 外のファイルを
// 読み・複製する経路ができる。コピーしていた頃は copyFile が内容を実体としてコピーしていたため
// この経路は無く、その場参照にしたこの変更で初めて到達可能になった。
async function planValSource(
  projectRoot: string,
  valPath: string
): Promise<{ readonly ok: true; readonly value: ValSourcePlan } | {
  readonly ok: false;
  readonly diagnostics: readonly Diagnostic[];
}> {
  // project root 自体が symlink 経由で到達されることがある(macOS の /tmp、Windows の junction)。
  // 両側を realpath に揃えないと、正当な project まで「外」と誤判定する。
  const realRoot = await resolveRealPath(projectRoot, {
    code: "PART_ADD_SOURCE_UNREADABLE",
    message:
      "project root の実体パスを解決できませんでした。/ Could not resolve the real path of the project root."
  });

  if (!realRoot.ok) {
    return realRoot;
  }

  const realVal = await resolveRealPath(valPath, {
    code: "PART_ADD_SOURCE_UNREADABLE",
    message:
      "取り込む .val の実体パスを解決できませんでした。/ Could not resolve the real path of the .val to add."
  });

  if (!realVal.ok) {
    return realVal;
  }

  const insideByPath = isPathWithin(projectRoot, valPath);
  const insideByReal = isPathWithin(realRoot.value, realVal.value);

  // パス上は project 内なのに実体は外 = symlink が外を指している。どちらの意図かを Loomit が
  // 決めつけず(外のファイルが欲しいのか、置き間違いなのか)、実体パスを渡し直すよう促して止める。
  if (insideByPath && !insideByReal) {
    return { ok: false, diagnostics: [escapesProjectDiagnostic(valPath, "取り込む .val")] };
  }

  if (insideByReal) {
    // 相対部分は realpath フレームで求める(境界判定と同じ土俵にそろえる)。この相対パスは呼び手の
    // フレームでも同じものを指す ── <shortRoot>/x.val と <realRoot>/x.val は同じファイルなので。
    const relativePath = toPosixPath(relative(realRoot.value, realVal.value));

    return {
      ok: true,
      value: {
        // 実体パスをそのまま返さず、渡された projectRoot から組み直す。呼び手(CLI)は
        // relative(projectRoot, sourceFilePath) で表示するため、realpath 済みのパスを返すと
        // フレームが混ざって ".." だらけの壊れたパスになる。Windows の 8.3 短縮名
        // (C:\Users\RUNNER~1 ⇔ C:\Users\runneradmin)や symlink 経由の projectRoot で実際に起きる。
        sourceFilePath: resolve(projectRoot, relativePath),
        relativePath,
        copy: false
      }
    };
  }

  const target = join(projectRoot, basename(valPath));
  const existence = await checkPathExistence(target);

  if (existence.kind === "inaccessible") {
    return {
      ok: false,
      diagnostics: [
        describeFsError(existence.error, {
          code: "PART_ADD_SOURCE_TARGET_UNREADABLE",
          message:
            "取り込み先に同名ファイルがあるか確認できませんでした。/ Could not determine whether a file with the same name already exists at the import target.",
          target,
          suggestion: ["Check the project path and filesystem permissions."]
        })
      ]
    };
  }

  if (existence.kind === "exists") {
    // 取り込み先の同名ファイル自体が、外を指す symlink であることがある(手で張った / fork で持ち込まれた)。
    // 内容一致で参照に落とす前に実体境界を見る ── 見ないと、渡された .val の側だけを守っても
    // 「project 内の名前で project 外を読む」状態が同じように成立してしまう。
    const realTarget = await resolveRealPath(target, {
      code: "PART_ADD_SOURCE_TARGET_UNREADABLE",
      message:
        "取り込み先の同名ファイルの実体パスを解決できませんでした。/ Could not resolve the real path of the existing file at the import target."
    });

    if (!realTarget.ok) {
      return realTarget;
    }

    if (!isPathWithin(realRoot.value, realTarget.value)) {
      return {
        ok: false,
        diagnostics: [escapesProjectDiagnostic(target, "取り込み先の同名ファイル")]
      };
    }

    const identical = await hasSameContents(valPath, target);

    if (identical === undefined) {
      return {
        ok: false,
        diagnostics: [
          createDiagnostic({
            severity: "error",
            code: "PART_ADD_SOURCE_TARGET_UNREADABLE",
            message:
              "取り込み先の同名ファイルを読めず、同じものか判定できませんでした。/ Could not read the existing file at the import target to compare it with the source.",
            target,
            suggestion: ["Check read permissions, or move the existing file out of the way."]
          })
        ]
      };
    }

    if (!identical) {
      return {
        ok: false,
        diagnostics: [
          createDiagnostic({
            severity: "error",
            code: "PART_ADD_SOURCE_TARGET_CONFLICT",
            message: `project root に同名の別ファイルが既にあります: ${basename(valPath)} / A different file with the same name already exists at the project root: ${basename(valPath)}`,
            target,
            suggestion: [
              "Rename the .val being added, or remove the existing file if it is no longer needed."
            ]
          })
        ]
      };
    }

    // 同一内容 = 既に取り込み済み。上書きせずそのまま参照する。
    return {
      ok: true,
      value: { sourceFilePath: target, relativePath: basename(valPath), copy: false }
    };
  }

  return {
    ok: true,
    value: { sourceFilePath: target, relativePath: basename(valPath), copy: true }
  };
}

// symlink を解決した実体パスを返す。R2 の境界判定はすべてこの実体パスで行う ── パス文字列だけで
// 内外を判断すると、project 内に置かれた symlink が外を指していても「内側」と通してしまう。
// realpath の失敗は握りつぶさない(R3)。判定できないまま進むと、外を指す symlink を内側と誤認しうる。
async function resolveRealPath(
  path: string,
  context: { readonly code: string; readonly message: string }
): Promise<
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }
> {
  try {
    return { ok: true, value: await realpath(path) };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        describeFsError(error, {
          code: context.code,
          message: context.message,
          target: path,
          suggestion: ["Check the path and filesystem permissions."]
        })
      ]
    };
  }
}

// 「project 内にあるはずのパスの実体が外だった」ことを伝える診断。渡された .val と、取り込み先に既に
// あった同名ファイルの両方で同じ構図が起きるため、文言だけ差し替えて共有する。
function escapesProjectDiagnostic(path: string, subject: string): Diagnostic {
  return createDiagnostic({
    severity: "error",
    code: "PART_ADD_SOURCE_ESCAPES_PROJECT",
    message: `${subject}が project 内の symlink で、実体が project の外にあります。/ ${subject} is a symlink inside the project whose target lies outside the project.`,
    target: path,
    suggestion: [
      "Pass the real path of the .val so Loomit can import a copy into the project, or replace the symlink with the file itself."
    ]
  });
}

// 2ファイルの内容が同一か。どちらかを読めなければ undefined(判定不能)を返し、呼び手が「同じ」と
// 決めつけずにエラーへ倒せるようにする。比較はバイト列(.val は UTF-8 だがデコードで偽の一致を作らない)。
async function hasSameContents(left: string, right: string): Promise<boolean | undefined> {
  try {
    const [leftBytes, rightBytes] = await Promise.all([readFile(left), readFile(right)]);
    return leftBytes.equals(rightBytes);
  } catch {
    return undefined;
  }
}

// 取り込む .val が「実在する通常ファイル」かを確認する。問題なければ undefined、駄目なら診断を返す。
// CLI は対話を始める前にこれを呼んで即座に失敗させ(全部入力させてから「無い」と言わない)、core も
// 書き込み直前の最終ガードとして同じものを使う。メッセージを1箇所に保つための共有ヘルパー。
//
// 通常ファイル判定が要るのは、project 内の .val をコピーせずその場参照するようになったため。以前は
// 必ず copyFile が走り、ディレクトリを渡すと EISDIR で add 時に落ちていた(コピーが暗黙の検証を
// 兼ねていた)。コピーをやめた今それを明示しないと、ディレクトリを指す part.loom が書けてしまい、
// 失敗が後段の射影(PART_SOURCE_VAL_READ_FAILED)まで遅れて原因が分かりにくくなる。
export async function checkValSourceExists(valPath: string): Promise<Diagnostic | undefined> {
  const resolved = resolve(valPath);

  // access() ではなく stat() を使う。access() はディレクトリでも成功するため、通常ファイルかどうかを
  // 判定できない。失敗の errno 分類は access() と同じ規則を共有する(R3)。
  let stats: Stats;

  try {
    stats = await stat(resolved);
  } catch (error) {
    const classified = classifyAccessError(error);

    if (classified.kind === "inaccessible") {
      return describeFsError(classified.error, {
        code: "PART_ADD_SOURCE_UNREADABLE",
        message:
          "取り込む .val ソースにアクセスできませんでした。/ The .val source to add could not be accessed.",
        target: resolved,
        suggestion: ["Check the path to the .val file and filesystem permissions."]
      });
    }

    return createDiagnostic({
      severity: "error",
      code: "PART_ADD_SOURCE_NOT_FOUND",
      message: "The .val source to add was not found.",
      target: resolved,
      suggestion: ["Check the path to the .val file."]
    });
  }

  if (!stats.isFile()) {
    return createDiagnostic({
      severity: "error",
      code: "PART_ADD_SOURCE_NOT_A_FILE",
      message:
        "取り込む .val ソースが通常のファイルではありません(ディレクトリ等)。/ The .val source to add is not a regular file (for example, a directory).",
      target: resolved,
      suggestion: ["Point loom add at a .val file, not a directory."]
    });
  }

  return undefined;
}

// 回答から Part を組み立て、書き込む前に正本 schema で検証する。CLI 側で弾ききれない値(例: 負の
// length_mm)があっても、schema に合わない part.loom を生成しないための最後の関所。piece があれば
// files.piece に載せ、どの <detail> を担当する part かを part.loom 自身に持たせる。
function buildPart(
  options: AddPartToProjectOptions,
  valBasename: string,
  role: string
): LoadFileResult<Part> {
  const connectors = buildConnectors(options.connectors);
  const draft = {
    schema: "loomit.part.v0",
    name: options.name,
    variant: options.variant,
    type: options.type,
    files: {
      source: valBasename,
      ...(options.piece === undefined ? {} : { piece: options.piece })
    },
    ...(connectors === undefined ? {} : { connectors })
  };

  const parsed = partSchema.safeParse(draft);

  if (!parsed.success) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "PART_ADD_SCHEMA_INVALID",
          message: "The generated part.loom does not match the schema.",
          target: `parts.${role}`,
          suggestion: [parsed.error.issues.map((issue) => issue.message).join("; ")]
        })
      ]
    };
  }

  return { ok: true, value: parsed.data, diagnostics: [] };
}

function buildConnectors(
  inputs: readonly AddPartConnectorInput[] | undefined
): Record<string, Connector> | undefined {
  if (inputs === undefined || inputs.length === 0) {
    return undefined;
  }

  const connectors: Record<string, Connector> = {};

  for (const input of inputs) {
    // 同じ seam を二重登録した場合は後勝ちにせず、最初の1件を残す(CLI 側でも重複は避けるが二重の安全策)。
    if (connectors[input.id] === undefined) {
      // type(種類ラベル)は id とは別軸。未指定なら id にフォールバックする(旧来の id=type 互換)。
      // これにより「同じ type の別の縫い目」を、一意な id を保ったまま同じ type で表せる。
      // length_mm は未測定なら載せない(identity だけの connector にする)。
      connectors[input.id] = {
        type: input.type ?? input.id,
        ...(input.lengthMm === undefined ? {} : { length_mm: input.lengthMm })
      };
    }
  }

  return connectors;
}
