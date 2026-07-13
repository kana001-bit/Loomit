# Glossary

この文書は、Loomit のドキュメントで使用される洋裁用語および Loomit 固有の概念をまとめたものです。

---

# Sewing Terms

## Pattern

服を作るための型紙。
Loomit では主に Valentina の `.val` ファイルを指す。

---

## Part

型紙を構成する一つの部品。
一着の服は複数の Part から構成される。

代表例:

- Front Bodice（前身頃）
- Back Bodice（後身頃）
- Sleeve（袖）
- Collar（襟）
- Cuff（カフス）

Loomit では Part が互換判定・再利用・Diff の基本単位になる。

---

## Bodice（身頃）

服の胴体部分を覆うパーツ。
一般的には次の二つに分かれる。

- Front Bodice（前身頃）
- Back Bodice（後身頃）

---

## Sleeve（袖）

腕を覆うパーツ。
通常は Armhole で Bodice（身頃）と縫い合わされる。

---

## Collar（襟）

首まわりに付くパーツ。

---

## Cuff（カフス）

袖口に付くパーツ。
袖口の形状や開きを整える役割を持つ。

---

## Facing（見返し）

襟ぐりや前端などの裏側に付ける補強用パーツ。
表からは基本的に見えない。

---

## Armhole（袖ぐり）

袖を取り付けるための開口部。
身頃と袖を縫い合わせる境界になる。

---

## Neckline

首まわりの開口部。
襟が付く位置でもある。

---

## Shoulder

肩部分の縫い合わせ位置。
前身頃と後身頃を接続する。

---

## Side Seam

身頃の脇を縫い合わせる縫い目。

---

## Hem

服の裾、または裾を折り返して処理する部分。

---

## Waist

服におけるウエスト位置。
人体のウエストそのものではなく、型紙上の位置を指す場合もある。

---

## Seam

二つの Part を縫い合わせる縫い目、またはその接続部分。
ちなみにシームレスは縫い目がなく、滑らかにつながっていること。

---

## Seam Allowance（縫い代）

実際に縫うために型紙へ追加する余白。
完成時には服の内側へ隠れる。

---

## Connector

Loomit が縫い合わせ可能な境界として扱う情報。

Connector は **id** と **type** の2軸を持つ。

- **id**（record キー）は縫い目ごとに一意な rendezvous。同じ id を宣言したパーツが1本の縫い目に参加する。`loom check` はこの id で参加者を集めて assembly グラフの整合を見る。**「1本の縫い目 = 2枚」とは限らない**（見返し/裏地/ポケット重ねは N 枚が1本に参加する coincident な縫い目、set-in sleeve の armhole は多パーツの端どうしを1本で縫う contiguous な縫い目）。よって「3パーツ以上 = error」ではない。詳細は下記 **side** と `design-history.md` の assembly の章。
- **type** は縫い目の種類ラベル。ペアリングには使われない分類語で、同じ type の縫い目が複数あってよい（その区別は id が担う）。
- **side**（任意）は contiguous な縫い目で、その縫い目でこのパーツがどちらの側（unit）に属すかのラベル。armhole のように多パーツの端が「和」で合う縫い目を、参加ピースを2つの側（例: 身頃側 / 袖側）にまとめて表す。side を宣言した縫い目は「側がちょうど2なら健全（`CONNECTOR_JOIN_TOO_MANY_SIDES` は3側以上のとき）」。side 無しは coincident（重ね・各参加が等長）。unit 所属は縫い目ごと（front は脇では piece 単位、armhole では身頃 unit）なので part ではなく connector に載る。長さ（和・いせ）の実測は Seamlint。
- **band seam** は contiguous のうち、**片側がちょうど1枚（band）・反対側が複数枚（neighbours）** の形。band の周方向辺の長さが neighbours の接辺の和に等しい（腰帯 ↔ 前+後、袖山 ↔ 前身頃+後身頃）。この形は `loom slnt check` が `band-seam` check を1本発行し、和の照合は Seamlint（`matchBandSubrange`）が担う。authoring は `loom connect <band> --to <neighbours...>`（side はコマンドが裏で書く）。両側とも複数枚の和は今のところ defer（`SEAMLINT_CONNECTOR_SEAM_DEFERRED`）。詳細は `design-history.md` の band の章。

type の例（**種類の例であって id ではない**）:

- armhole
- neckline
- shoulder
- side seam
- waist
- hem

例えば脇の縫い目が左右に2本あるとき、type はどちらも `side`（同じ種類）だが、id は `side_left` / `side_right` のように別（別の縫い目）にする。

Connector には長さや接続条件などの情報が含まれ、互換判定の対象になる。

---

## Dart（ダーツ）

平面の布を立体的な形状にするための構造。
余分な布をつまんで縫うことで、胸やウエストなどの曲面を表現する。
Loomit では、人が頻繁に編集する設計フィーチャとして扱う。

---

## Notch（合印）

型紙の端に付ける小さな切り込みや印。
縫い合わせ位置を正しく合わせるための目印として使われる。

---

## Ease（ゆとり量）

身体寸法より大きく設計するための余裕。
着心地や動きやすさに大きく影響する。

---

## Prototype（試作品）

実際に布で製作し、着心地や動作を確認するための服。
Loomit は Prototype をなくすことではなく、より効率的に行うことを目指している。

---

# Loomit Concepts

## Project

一着の服を管理する単位。
Project には Part、設定、Prototype Notes などが含まれる。

---

## Library

再利用したい Part を保存する場所。
Project 内の Part は自動では登録されず、明示的に publish したものだけが Library に保存される。

---

## Publish

Part を Library へ登録する操作。
Library に登録された Part は他の Project へコピーして利用できる。

---

## Prototype Notes

試作品から得られた知見を記録するデータ。
例:

- 腕が上がりにくい
- 脇が突っ張る
- この袖は縫いやすかった
  Prototype Notes は型紙そのものではなく、試作によって得られた経験を保存する。

---

## Variant

同じ Part の異なるデザインを識別する名前。
Version のような新旧関係は持たず、異なる設計案として扱われる。

---

## Snapshot（スナップショット）

ある時点の Project state を丸ごと固定したもの。`loom diff` が比較する「変更前 / 変更後」の一方の状態を指す。

Loomit は snapshot を**自前で保存しない**。保存・履歴・branch・merge は Git に委譲し（[design-history.md](design-history.md) の「diff だけでは足りない」の章）、Loomit は2つの snapshot を意味的に読む（diff）ことに集中する。したがって `loom commit` / `loom snapshot` のような保存コマンドは持たない。snapshot を作るのは `git commit`（Valentina / エディタで保存したうえで）。

---

## Revision（リビジョン）

snapshot を指すための handle（参照）。history を Git に委譲する方針（leaning A）では、revision は素の **Git revision**（`main`, `HEAD`, または SHA）そのもので、**1つ**の snapshot を指す。`loom diff <rev> --part <role>` の `<rev>` がこれで、指定された revision の snapshot を一時 worktree に展開して diff する。

- **snapshot** = 状態そのもの（概念）
- **revision** = その snapshot を addressing する Git 上の参照（1つの版）
- `main..HEAD` は revision **ではなく**、2つの revision の**範囲**（＝比較する2つの snapshot の指定）。`loom diff main..HEAD` はこの2版を比べる。Loomit は `..` を自前で分割し、両辺をそれぞれ1つの revision として解決する。

Loomit は revision を独自に採番せず、Git の revision をそのまま使う。

---

# Related Projects

## Valentina

オープンソースのパターンメイキング CAD。
Loomit は Valentina が作成した `.val` ファイルを読み込み、解析や履歴管理、Diff を行う。

---

## Seamlint

Loomit と連携する静的解析ツール。
パーツ同士の互換性や縫製上の問題を検査する。

---

## Truer

Loomit と連携するツール。
CAD 側の形状補正や高度な幾何編集を担当する予定である。

### 担当する責務(メモ)

- **connector の `length_mm`(仕上がり seam 長)の測定。**
  この値は `.val` に数値として実在せず、seam path の弧長=パラメトリックモデル(点の数式＋寸法参照＋曲線)を
  評価して初めて出る**計算値**である。「`.val` が正本だから読めば取れるはず」は精神としては正しい(正本は `.val`)が、
  実務としては**読取り射影ではなく幾何計算**が要る。Loomit は幾何を計算しない([A案](work/diffable-domain.md):
  CAD エンジンは作らない)ため、`.val` から seam 長を測って `connectors.*.length_mm` を埋めるのは
  Truer(または Valentina)側の責務とする。
  - 現状の Loomit 側(2026-07-08): `loom add` は `length_mm` を手入力で強制せず optional(未測定可)にした。
    未測定の connector は `type`(identity)だけを持ち、`loom check` は未測定ペアを比較せず
    `CONNECTOR_LENGTH_UNMEASURED` warning で「Valentina / truer で測って埋めて」と促す。
    参照: `connectorSchema.length_mm`(optional 化)/ `connector-length` rule(未測定は比較せず warning)。
