// Repo-root flat config, and the only place `scripts/` and `tools/` can be
// linted from — ESLint refuses to lint any file above its config file, so
// web/eslint.config.mjs cannot reach them no matter what globs it declares.
//
// The config object itself is defined in web/eslint.config.mjs because plugin
// resolution only works from web/node_modules; this file just re-exports it.
// web/ keeps using its own config for the Next.js app.
export { nodeScripts as default } from "./web/eslint.config.mjs";
