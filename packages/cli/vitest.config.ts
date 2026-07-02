import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const configDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@loomit/core": resolve(configDir, "../core/src/index.ts")
    }
  },
  test: {
    globals: false,
    include: ["test/**/*.test.ts"],
    passWithNoTests: true
  }
});
