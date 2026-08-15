// 診断が「プロジェクトの中のどれについて言っているか」の構造化表現。
//
// もともと `Diagnostic.target` は string で、testing-diagnostics.md が形式を散文で列挙しているだけだった。
// 実測(2026-08-13)すると実際には 11 種類の形が出ていて、**同じ 2 セグメントでも `{role}.{connectorId}` と
// `{joinId}.{side}` が区別できない**、`", "` 結合で N 個の対象が 1 本の文字列に畳まれている、パスが絶対と
// 相対で混在している、といった穴があった。消費側(`--format json`)は code を見ないと形を決められず、
// role と connector id が字面衝突すればパース自体が不能になる。
//
// そこで **どれについてかは構造で持ち、表示用文字列は formatDiagnosticSubject が組む** 形にした。
// 判別可能ユニオンなので、消費側は kind で分岐でき、Loomit 側も新しい形を足すと網羅漏れが型で挙がる。
export type DiagnosticSubject =
  // プロジェクト内のファイル。path は project root からの相対 posix(絶対パスを出すと JSON に
  // ユーザーのホームディレクトリと Windows のバックスラッシュが漏れる)。
  // fragment はファイル内部の位置で、`.val` の draw/seam/node のような階層を段で持つ。
  | { readonly kind: "file"; readonly path: string; readonly fragment?: readonly string[] }
  // role で指した part 1 枚。
  | { readonly kind: "part"; readonly role: string }
  // ある part の上のコネクタ宣言。**string 時代に `{joinId}.{side}` と衝突していたのがこの形。**
  | { readonly kind: "connector"; readonly role: string; readonly connectorId: string }
  // 縫い目そのもの(同じ id を宣言している part を横断した束)。part には紐づかない。
  | { readonly kind: "join"; readonly joinId: string }
  // 縫い合わせる 2 辺の組。string 時代は `/` 区切りで 1 本に畳んでいた。
  | {
      readonly kind: "seam";
      readonly from: DiagnosticSeamSide;
      readonly to: DiagnosticSeamSide;
    }
  // 他の subject の内側のフィールド。`sleeve.armhole.length_mm` のような「どこの何」を、
  // 対象(within)と項目(path)に割る。within を省くとプロジェクトファイル直下の項目を指す(`parts.front`)。
  | {
      readonly kind: "field";
      readonly path: readonly string[];
      readonly within?: DiagnosticSubject;
    }
  // 対象が複数ある 1 件の診断。**string 時代に `", "` 結合で潰れていたのがこれ。**
  // 消費側が分割しても元に戻せなかった(セグメント区切りの `.` と衝突しないだけで、構造としては別物)。
  //
  // **items は 2 件以上**をタプルで強制する。0 件や 1 件を許すと、同じ意味に 2 つの形ができてしまう
  // (`{ kind: "many", items: [x] }` と素の `x`、`items: []` と target なし)。消費側は両方を扱う分岐を
  // 書く羽目になり、`items: []` は表示すると空文字になって「対象が無い」と見分けがつかない。
  // 組み立ては combineDiagnosticSubjects を通す。
  | {
      readonly kind: "many";
      readonly items: readonly [DiagnosticSubject, DiagnosticSubject, ...DiagnosticSubject[]];
    }
  // 上のどれでもない自由語(movement test の scenario 名など、プロジェクト構造上の位置を持たないもの)。
  // **移行の逃げ道ではない。** 構造で表せるものをここに入れると、消費側は結局パースに戻る。
  | { readonly kind: "text"; readonly value: string };

// seam の片側。range を切ってある場合だけ rangeId が付く(`front.outseam.r1` の `r1`)。
export interface DiagnosticSeamSide {
  readonly role: string;
  readonly connectorId: string;
  readonly rangeId?: string;
}

// subject を人が読む 1 行に落とす。**string 時代の表示と 1 文字も変えない**のが移行中の要件で、
// これが満たされている限り、既存のテキスト出力テストが移行の裏取りになる。
//
// JSON 出力にはこの文字列ではなく構造がそのまま載る(doctorReport)。表示のためだけの関数。
export function formatDiagnosticSubject(subject: DiagnosticSubject): string {
  switch (subject.kind) {
    case "file":
      return subject.fragment === undefined || subject.fragment.length === 0
        ? subject.path
        : `${subject.path}#${subject.fragment.join("/")}`;
    case "part":
      return subject.role;
    case "connector":
      return `${subject.role}.${subject.connectorId}`;
    case "join":
      return subject.joinId;
    case "seam":
      return `${formatSeamSide(subject.from)}/${formatSeamSide(subject.to)}`;
    case "field":
      return subject.within === undefined
        ? subject.path.join(".")
        : `${formatDiagnosticSubject(subject.within)}.${subject.path.join(".")}`;
    case "many":
      return subject.items.map(formatDiagnosticSubject).join(", ");
    case "text":
      return subject.value;
  }
}

// 対象が複数ありうる診断のための組み立て。**0 件は undefined(= target なし)、1 件はその subject、
// 2 件以上だけが many** になる。戻りが undefined を含むのは、空の集合に「対象がある」形を与えないため。
//
// 包む/包まないの判断を各 emit 箇所に書かせると、片方が `{ kind: "many", items: [x] }`、もう片方が
// 素の x になって、消費側は同じ意味の 2 形を両方扱う羽目になる。規則はここに 1 つだけ置く。
export function combineDiagnosticSubjects(
  items: readonly DiagnosticSubject[]
): DiagnosticSubject | undefined {
  const [first, second, ...rest] = items;

  if (first === undefined) {
    return undefined;
  }

  if (second === undefined) {
    return first;
  }

  return { kind: "many", items: [first, second, ...rest] };
}

function formatSeamSide(side: DiagnosticSeamSide): string {
  const base = `${side.role}.${side.connectorId}`;
  return side.rangeId === undefined ? base : `${base}.${side.rangeId}`;
}
