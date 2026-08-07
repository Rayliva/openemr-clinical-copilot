/**
 * Baseline generator (W2 eval gate). Runs the full golden set through the runner on the HAPPY path
 * (no injection) and writes the per-category pass rates to `baseline.json` — the committed reference
 * the gate compares each run against (`docs/specs/w2-eval-runner.md` §Baseline). Reproducible from
 * the repo alone; deterministic and offline (stub engine only).
 *
 * This dir is not a pnpm workspace member, so no plain TS runner (tsx/ts-node) is on the path — the
 * generator is driven by vitest (the one TS-capable binary here), which supplies the
 * `@copilot/eval-harness` → source alias. The write is wrapped in a trivial suite so vitest exits 0;
 * the file is named `generate-baseline.ts` (not `*.test.ts`), so the gate test run never picks it up.
 * Reproduce the committed baseline with:
 *   packages/eval-harness/node_modules/.bin/vitest run --config evals/w2/generate-baseline.config.ts
 * Review the diff, then commit `baseline.json`.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { runGoldenSet, RUBRIC_CATEGORIES, type Baseline } from "@copilot/eval-harness";
import { goldenCases } from "./cases/index.js";

/** Per-category pass rate from the accepted happy run — only categories actually exercised. */
export function generateBaseline(): Baseline {
  const { results } = runGoldenSet(goldenCases, {});
  const baseline: Baseline = {};
  for (const category of RUBRIC_CATEGORIES) {
    let passed = 0;
    let total = 0;
    for (const result of results) {
      const value = result.results[category];
      if (value === undefined) {
        continue;
      }
      total += 1;
      if (value) {
        passed += 1;
      }
    }
    if (total > 0) {
      baseline[category] = passed / total;
    }
  }
  return baseline;
}

/** Write `baseline.json` beside this module and return the path written. */
export function writeBaseline(): string {
  const baseline = generateBaseline();
  const path = fileURLToPath(new URL("./baseline.json", import.meta.url));
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  return path;
}

describe("W2 baseline generator", () => {
  it("writes per-category pass rates from the accepted happy run to baseline.json", () => {
    const path = writeBaseline();
    const baseline = generateBaseline();
    // The full golden set exercises every rubric category on the happy path.
    for (const category of RUBRIC_CATEGORIES) {
      expect(baseline[category], `no rate for ${category}`).toBeTypeOf("number");
    }
    expect(path.endsWith("baseline.json")).toBe(true);
  });
});
