# Loomit Tutorials

Loomit の基本的な使い方を、実行例で示す。

## Loomit が扱うもの

Loomit は、1着の服を1つの project として扱う。

```text
my-blouse-001/
  loomit.yml
  parts/
  notes/
  profiles/
  output/
```

CLI は大きく4種類の作業を支える。

- `loom init` と `loom fork` で garment project を作る・複製する
- `loom check` と `loom doctor` で互換性を検証し、失敗理由を読む
- `loom diff` で設計ブランチの差分を読む
- `loom fit`、`loom suggest-tests`、`loom test`、`loom publish`、`loom library` で fit 診断、動作テスト候補、再利用パーツ管理を行う

## 準備

```bash
pnpm install
pnpm build
```

以降の例では、build 済みの CLI を `node packages/cli/dist/main.js` で呼ぶ。

## 例1: プロジェクトを検証する

fixture project を検証する。

```bash
node packages/cli/dist/main.js check packages/core/test/fixtures/valid-blouse
```

```text
Loomit check: ok

Compatibility:
  [ok] connector-length body.armhole -> sleeve.armhole
  [ok] requirement-range body.requires.sleeve.armhole.length_mm -> sleeve.armhole.length_mm
  [ok] requirement-range sleeve.requires.body.armhole.length_mm -> body.armhole.length_mm
```

connector 長が許容差に収まり、requirement の寸法条件も満たすと `ok` になる。CI では exit code で結果を判定できる。

## 例2: 2つの revision を意味的に比較する

パーツの2つの版を比較し、座標や blob ではなくドメインの変更として差分を読む。

```bash
node packages/cli/dist/main.js diff bodice-v1.part.loom bodice-v2.part.loom
```

```text
Loomit diff: changed
From: bodice@v1 (body)
To:   bodice@v2 (body)

Summary:
  silhouette impact: medium
  volume change:     reduced
  connection risk:   none
  prototype notes:   none

Changes:
  [modified] dart waist_front
    - width_mm: 30 -> 35
    - intake_length_mm: 110 -> 120
    - legs.right_ref: val:point#bodice/Right -> val:point#bodice/RightMoved
```

Summary は「この試作ブランチを残すか捨てるか」を素早く判断するための要約シグナルであり、正確な計測ではない。個々の変更は Changes に出る。
