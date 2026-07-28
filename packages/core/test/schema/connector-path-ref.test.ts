import { describe, expect, it } from "vitest";

import { normalizeConnectorPathRef } from "../../src/schema/connectorPathRef.js";

describe("normalizeConnectorPathRef", () => {
  it("takes the fragment as the path identifier", () => {
    // 守る仕様: SVG 形式の path_ref(svg:path#armhole / #armhole)は "#" 以降だけが実際の識別子。
    // Seamlint request の paths と Truer payload の pathRef は、どちらもこの正規化後の綴りで出る。
    expect(normalizeConnectorPathRef("svg:path#armhole")).toBe("armhole");
    expect(normalizeConnectorPathRef("#armhole")).toBe("armhole");
  });

  it("leaves a plain DXF block name untouched, including its case", () => {
    // 守る仕様(must-not-fire): fragment の無い path_ref(DXF の BLOCK 名)は変換しない。**大小も畳まない** ──
    // Seamlint は要求された綴りをそのまま診断の blockName に echo するので、こちらが畳むと逆に一致しなくなる
    // (BLOCK 照合を大小無視でやるのは Seamlint 側の役割)。
    expect(normalizeConnectorPathRef("BACK")).toBe("BACK");
    expect(normalizeConnectorPathRef("back")).toBe("back");
  });

  it("keeps a trailing '#' as part of the value instead of emptying it", () => {
    // 守る仕様: "#" で終わる値は fragment が空なので、切り出すと識別子が消える。空文字にせず元の値を返し、
    // 「住所を持つが見つからない」として下流が理由を出せるようにする(黙って全 BLOCK に当たる形にしない)。
    expect(normalizeConnectorPathRef("BACK#")).toBe("BACK#");
  });
});
