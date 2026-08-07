import { fileURLToPath } from "node:url";

/**
 * Vitest config that runs the baseline GENERATOR (`generate-baseline.ts`) rather than the tests.
 * `evals/w2` is not a pnpm workspace member, so `@copilot/eval-harness` is aliased to source here
 * (same as `vitest.config.ts`). The generator writes `baseline.json` at module load; it is wrapped in
 * a trivial vitest suite so the runner has a test to collect and exits 0.
 *
 * Reproduce the committed baseline with:
 *   packages/eval-harness/node_modules/.bin/vitest run --config evals/w2/generate-baseline.config.ts
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
    include: ["generate-baseline.ts"],
    root: fileURLToPath(new URL(".", import.meta.url)),
    environment: "node",
  },
};
