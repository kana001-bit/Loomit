// role・connector id・range id は、Seamlint に渡す check id や marker キーを ":" "." "/" "__" で連結して
// 組み立てる際の構成要素になる。これらの区切り文字が id に混ざると別の seam と同じキーへ化けて衝突し、
// Seamlint は該当 join を測定対象から外す(createGeometryRequest の SEAMLINT_UNSAFE_JOIN_IDENTIFIER)。
// そこで「id が区切り文字を含まないか」を1箇所に定義し、request 発行時の skip 判定(createGeometryRequest)と
// authoring 時の事前バリデーション(loom connect)で同じ規則を使う(2箇所で別実装にして drift させない)。
export function isDelimiterSafeIdentifier(value: string): boolean {
  return !/[:./\\]/.test(value) && !value.includes("__");
}
