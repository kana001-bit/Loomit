import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

const configDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // テストは core の build 成果物(dist)ではなく src を直接見る。core を触るたびに再ビルドしなくて済む。
      "@loomit/core": resolve(configDir, "../core/src/index.ts")
    }
  },
  test: {
    globals: false,
    include: ["test/**/*.test.ts"],
    // dist/main.js を実バイナリとして起動する E2E は src を見る既定 suite から外す。
    // `pnpm test:e2e`(pnpm -r build 込み)で vitest.e2e.config.ts から明示的に回す。
    exclude: [...configDefaults.exclude, "test/**/*.e2e.test.ts"],
    passWithNoTests: true
  }
});
