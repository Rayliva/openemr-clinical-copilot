/**
 * The offline, deterministic {@link StubEngine} (T3, `docs/work-manifest.md`). The runner (T4)
 * injects one of these in place of the live LLM / VLM / OCR so the golden set runs in CI with no
 * live key. Every method is a pure function of its inputs — no clock, no randomness, no IO — so
 * the same input always yields the same output and the gate's "prove the red" self-test (S2) is
 * reliable rather than flaky (`.claude/rules/w2-eval-gate.md`).
 */
import type { StubEngine } from "../contracts.js";
import {
  INTAKE_EXTRACTION,
  INTAKE_OCR,
  LAB_EXTRACTION,
  LAB_OCR,
  resolveDocType,
  stableToken,
} from "./data.js";

/** Options for {@link createStubEngine}. */
export interface StubEngineOptions {
  /** When true, every method emits a deliberately WRONG output for the prove-the-red self-test. */
  readonly injectRegression?: boolean;
}

/** Deep clone via structured JSON so the returned object never aliases the shared happy-path const
 * (a caller mutating the result must not corrupt the next call's output). */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Build a deterministic offline stub engine. Pass `{ injectRegression: true }` to get the
 * wrong-on-purpose variant used by the gate self-test; omit for the real golden-set run.
 */
export function createStubEngine(options: StubEngineOptions = {}): StubEngine {
  const injectRegression = options.injectRegression ?? false;

  return {
    injectRegression,

    generate(prompt: string, caseId: string): string {
      if (injectRegression) {
        // A regressed answer that is BOTH uncited AND false-reassuring: no `[source:...]` marker
        // (so `citation_present` goes red) and packed with the false-reassurance phrasing an
        // empty-chart answer must never use — "normal", "clear", "no allergies", "all good" — so a
        // safety case's `mustNotContain` oracle drives `factually_consistent` red too (absence ≠
        // negative finding). One string exercises both deterministic regression-catchers.
        return "Her recent labs are normal and clear, she has no allergies, and everything looks good — all good to proceed.";
      }
      // Grounded, deterministic, and keyed off the case: a stable source token derived purely from
      // the inputs stands in for a retrieved row id, so the citation check passes. The case id is NOT
      // echoed into the prose (only into the token) — some case ids legitimately contain words a
      // factual oracle forbids (e.g. "…-labs-not-normal"), and the visible answer must stay neutral.
      const token = stableToken(`${caseId}|${prompt}`);
      return `Reviewed this patient's chart. [source:stub-row-${token}]`;
    },

    extract(documentFixtureId: string): unknown {
      const docType = resolveDocType(documentFixtureId);
      if (docType === "lab_pdf") {
        if (injectRegression) {
          // Malformed: strip the required `citation` from the first result → schema parse fails.
          const bad = clone(LAB_EXTRACTION) as { results: Array<Record<string, unknown>> };
          const first = bad.results[0];
          if (first !== undefined) {
            delete first["citation"];
          }
          return bad;
        }
        return clone(LAB_EXTRACTION);
      }
      // intake_form
      if (injectRegression) {
        // Malformed: drop the required top-level `citation` → schema parse fails.
        const bad = clone(INTAKE_EXTRACTION) as Record<string, unknown>;
        delete bad["citation"];
        return bad;
      }
      return clone(INTAKE_EXTRACTION);
    },

    ocr(documentFixtureId: string): unknown {
      const docType = resolveDocType(documentFixtureId);
      const page = docType === "lab_pdf" ? LAB_OCR : INTAKE_OCR;
      if (injectRegression) {
        // Malformed box: an out-of-[0,1] coordinate → `parseOcrMap` rejects it.
        const bad = JSON.parse(JSON.stringify(page)) as {
          words: Array<{ text: string; box: Record<string, number> }>;
        };
        const first = bad.words[0];
        if (first !== undefined) {
          first.box["x"] = 5;
        }
        return bad;
      }
      return clone(page);
    },
  };
}
