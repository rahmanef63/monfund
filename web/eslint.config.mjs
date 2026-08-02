import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

// Consumed by the repo-root eslint.config.mjs, which is where `scripts/` and
// `tools/` have to be linted from: ESLint silently skips any file above its own
// config file ("outside of base path"), so this config — rooted at web/ — can
// never reach them. The block lives here anyway because only web/node_modules
// can resolve @eslint/js; the root config is a bare re-export. That also means
// the globs below are relative to the *repo root*, not to web/.
export const nodeScripts = defineConfig([
  {
    files: ["scripts/**/*.mjs", "tools/**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      // Spelled out rather than pulled from the `globals` package: that package
      // is only present transitively here, it is not a dependency of eslint.
      globals: {
        console: "readonly",
        fetch: "readonly",
        globalThis: "readonly",
        process: "readonly",
        Response: "readonly",
        setTimeout: "readonly",
      },
    },
  },
]);

export default eslintConfig;
