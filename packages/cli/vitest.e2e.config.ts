import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const configDir = dirname(fileURLToPath(import.meta.url));

// dist/main.js を実バイナリとして spawn する CLI スモーク E2E 専用の設定。
// 既定の `pnpm test` は src を見る純粋な suite のままにし、この e2e は `pnpm test:e2e`
// (pnpm -r build で dist を建ててから)で明示的に回す。subprocess 起動で @loomit/core を
// in-process import しないため、core の src alias は不要。
// root を packages/cli に固定するのは、repo root から `--config` で回しても include が
// packages/cli/test を基準に解決されるようにするため(相対 glob は forward slash で書き、
// Windows でバックスラッシュ glob になってマッチしない事故を避ける)。
export default defineConfig({
  root: configDir,
  test: {
    globals: false,
    include: ["test/**/*.e2e.test.ts"],
    passWithNoTests: false
  }
});
