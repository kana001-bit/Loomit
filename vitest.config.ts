import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 各 package の vitest.config.ts を project として読み込む。root から `vitest` を直接実行しても、
    // per-package の設定(特に CLI の `@loomit/core` → core/src alias)が効き、テストは build 成果物
    // (dist)ではなく src を見る。`pnpm -r test` と同じ解決になり、再ビルド漏れによる食い違いを防ぐ。
    projects: ["packages/*/vitest.config.ts"]
  }
});
