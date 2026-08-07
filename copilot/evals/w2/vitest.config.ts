import { fileURLToPath } from "node:url";

/**
 * Colocated vitest config for the Week 2 golden set (`evals/w2`).
 *
 * `evals/w2` is intentionally NOT a pnpm workspace member (it is a self-contained data-authoring
 * dir, not a publishable package), so plain node resolution cannot find `@copilot/eval-harness`
 * (or `vitest/config`) from here. Two consequences, both handled locally without touching any
 * package config:
 *   1. We export a plain config object instead of importing `defineConfig` from `vitest/config`
 *      (`defineConfig` is only an identity helper), so loading this file needs no `vitest` on the
 *      resolution path — only the `node:url` builtin.
 *   2. We alias `@copilot/eval-harness` to the harness's TS source entry; its transitive deps
 *      (`zod`, `@copilot/eval-gate`) resolve from `packages/eval-harness/node_modules` after
 *      `pnpm install`.
 *
 * Run from the `copilot/` root with a vitest binary that exists in the workspace, e.g.:
 *   packages/eval-harness/node_modules/.bin/vitest run --config evals/w2/vitest.config.ts
 */
export default {
  resolve: {
    alias: {
      "@copilot/eval-harness": fileURLToPath(
        new URL("../../packages/eval-harness/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["**/*.test.ts"],
    root: fileURLToPath(new URL(".", import.meta.url)),
    environment: "node",
  },
};
