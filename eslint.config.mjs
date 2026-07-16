import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Node スクリプト(.mjs)向けの global。globals パッケージを増やさず、使う分だけ明示する。
const nodeGlobals = {
  console: "readonly",
  process: "readonly",
  Buffer: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly"
};

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // AGENTS の non-negotiable「any は使わない」を config でも明示する。recommended でも error だが、
    // preset の中身がバージョンで変わっても意図が固定されるよう、ここで宣言しておく。
    rules: {
      "@typescript-eslint/no-explicit-any": "error"
    }
  },
  {
    // .claude 配下などの Node スクリプトは ESM(.mjs)で実行される。stdout 出力に console/process を
    // 使うため、これらのファイルにだけ Node の global を与える(no-undef 対策)。
    files: ["**/*.mjs"],
    languageOptions: {
      globals: nodeGlobals
    }
  }
);
