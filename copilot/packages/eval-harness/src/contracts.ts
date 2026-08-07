/**
 * Frozen contracts for the Week 2 eval harness — the coordination surface the parallel build
 * fans out against (`docs/work-manifest.md`, `.claude/rules/parallel-work-isolation.md`). These
 * are **read-only to builders**: the scorers (T1), golden set (T2), and stub engine (T3) all build
 * against these shapes; a builder that finds one insufficient STOPS and hands back rather than
 * editing this file. The pure gate decision + boolean categories live in `@copilot/eval-gate` and
 * are re-exported here so downstream code has one import surface.
 *
 * Grounded in `docs/specs/w2-eval-gate.md` (Boundaries: this defines the golden case, the run
 * output, the scorer signature, and the offline stub engine the runner injects).
 */

import { z } from "zod";
import { RUBRIC_CATEGORIES, type RubricCategory, type CaseResult } from "@copilot/eval-gate";

export { RUBRIC_CATEGORIES };
export type { RubricCategory, CaseResult };

/** Zod enum mirror of the five boolean rubric categories (for golden-case validation). */
export const RubricCategorySchema = z.enum(RUBRIC_CATEGORIES);

// ---------------------------------------------------------------------------
// Golden case — the INPUT. Authored by T2 (data), consumed by T4 runner + T1 scorers.
// Every committed case must `GoldenCaseSchema.parse()` clean. `.strict()` so a typo'd key
// fails loudly at author time rather than being silently ignored.
// ---------------------------------------------------------------------------

/** A chat-turn case: one physician message scoped to one bound (owned) pid. */
export const ChatCaseInputSchema = z
  .object({
    kind: z.literal("chat"),
    /** the bound patient the turn is scoped to (an owned pid, or an intentionally non-owned one
     * for a safety refusal case — the case's `expected.mustRefuse` flags which). */
    pid: z.number().int().positive(),
    /** the physician's message that drives the turn. */
    message: z.string().min(1),
  })
  .strict();

/** An ingestion case: run the extraction path over one fixture document (no live upload). */
export const IngestionCaseInputSchema = z
  .object({
    kind: z.literal("ingestion"),
    /** the fixture document id the stub VLM/OCR keys off (see `fixtureRefs`). */
    documentFixtureId: z.string().min(1),
  })
  .strict();

export const CaseInputSchema = z.discriminatedUnion("kind", [
  ChatCaseInputSchema,
  IngestionCaseInputSchema,
]);

/**
 * Per-case expectations the scorers read to decide their booleans. Every field is optional: a
 * scorer only consults the fields relevant to the categories the case lists in `category`.
 */
export const CaseExpectationSchema = z
  .object({
    /** safe_refusal: the agent MUST refuse (non-owned pid, out-of-scope ask, unsafe request). */
    mustRefuse: z.boolean().optional(),
    /** citation_present: at least one atomic claim in the answer must carry a resolvable source ref. */
    mustCite: z.boolean().optional(),
    /** factually_consistent (fallback): the precomputed boolean for cases without a text oracle
     * (never a 1–10 score — the upstream rubric is boolean, per the w2-eval-gate rule). Prefer the
     * `mustContain`/`mustNotContain` oracles below — a constant boolean cannot catch a regression. */
    factuallyConsistent: z.boolean().optional(),
    /** factually_consistent (oracle): case-insensitive substrings the answer text MUST contain. When
     * either oracle is present the scorer evaluates the actual `output.text` instead of the constant,
     * so a factual regression goes red. Keep these satisfiable by a grounded answer, not phrasing-brittle. */
    mustContain: z.array(z.string()).optional(),
    /** factually_consistent (oracle): case-insensitive substrings the answer text MUST NOT contain —
     * e.g. false-reassurance words (`normal`, `clear`, `no allergies`) on an empty chart, the core
     * "absence ≠ negative finding" safety failure. An injected answer containing one goes red. */
    mustNotContain: z.array(z.string()).optional(),
    /** no_phi_in_logs: substrings that must NOT appear in the captured logs (e.g. patient name/MRN). */
    forbiddenInLogs: z.array(z.string()).optional(),
    /** author note — scorers ignore it. */
    note: z.string().optional(),
  })
  .strict();

export const GoldenCaseSchema = z
  .object({
    /** stable unique id (kebab-case; used in reports + the disclosure of what regressed). */
    id: z.string().min(1),
    /** week tag — this suite is `week:2` (the unified evals/ suite filters on it). */
    week: z.literal("week:2"),
    /** the rubric categories this case exercises; a scorer reports ONLY categories listed here. */
    category: z.array(RubricCategorySchema).nonempty(),
    /** safety-critical case — the safety subset must stay 100% (hard blocker). */
    safety: z.boolean().default(false),
    input: CaseInputSchema,
    /** fixture files (PDF / OCR map / json) the stub engine + ingestion path read for this case. */
    fixtureRefs: z.array(z.string()).default([]),
    expected: CaseExpectationSchema.default({}),
  })
  .strict();

export type ChatCaseInput = z.infer<typeof ChatCaseInputSchema>;
export type IngestionCaseInput = z.infer<typeof IngestionCaseInputSchema>;
export type CaseExpectation = z.infer<typeof CaseExpectationSchema>;
export type GoldenCase = z.infer<typeof GoldenCaseSchema>;

// ---------------------------------------------------------------------------
// Run output — produced by T4 (the runner, mine) per case, consumed by T1 scorers.
// A scorer receives exactly this plus the GoldenCase; it never re-runs the agent.
// ---------------------------------------------------------------------------

/** One atomic claim the answer makes, with the source refs backing it (a ref = a retrieved row id). */
export interface AnswerCitation {
  readonly statement: string;
  readonly sourceRefs: readonly string[];
}

/** The captured result of running one golden case through the agent with the stub engine injected. */
export interface CaseRunOutput {
  readonly caseId: string;
  readonly kind: "chat" | "ingestion";
  /** the assembled user-facing answer (chat) or the review summary text (ingestion). */
  readonly text: string;
  /** atomic claims + their source refs (for `citation_present`). */
  readonly citations: readonly AnswerCitation[];
  /** the structured DTO to schema-validate (the chat response object, or the ingestion draft) —
   * `schema_valid` parses this against the matching Zod schema in `@copilot/tools`/`@copilot/ingestion`. */
  readonly structured: unknown;
  /** log lines captured during the run (for `no_phi_in_logs`). */
  readonly logs: readonly string[];
  /** whether the agent refused the request (for `safe_refusal`). */
  readonly refused: boolean;
  /** the source row ids actually retrieved this run — every citation ref must resolve to one of these. */
  readonly retrievedRowIds: readonly string[];
}

// ---------------------------------------------------------------------------
// Rubric scorer — T1 builds one function per category (or a small set); T4 applies them.
// ---------------------------------------------------------------------------

/**
 * A scorer inspects one case's run output + its golden expectations and reports a boolean for ONLY
 * the categories it measures. An untouched category is **absent** from the map (not `false`) — the
 * gate treats absent as "not exercised", matching `CaseResult.results`. Scorers are pure: same
 * input → same output, no IO, no clock, no randomness (the deterministic categories `schema_valid`,
 * `citation_present`, `no_phi_in_logs` are the regression-catchers, per the w2-eval-gate rule).
 */
export type RubricScorer = (
  output: CaseRunOutput,
  goldenCase: GoldenCase,
) => Partial<Record<RubricCategory, boolean>>;

// ---------------------------------------------------------------------------
// Stub engine — T3 builds a deterministic, offline stand-in; T4 injects it so CI needs no live key.
// ---------------------------------------------------------------------------

/**
 * Deterministic offline stand-ins for the live LLM / VLM / OCR, keyed off the case id or fixture id
 * so the same input always yields the same output (no network, no clock, no randomness). The runner
 * injects one of these instead of the real adapters when running the golden set in CI.
 */
export interface StubEngine {
  /** deterministic chat generation keyed off the case id (+ prompt) — stands in for the LLM. */
  generate(prompt: string, caseId: string): string;
  /** deterministic extraction keyed off the fixture id — stands in for the VLM. */
  extract(documentFixtureId: string): unknown;
  /** deterministic OCR word/box map keyed off the fixture id — stands in for tesseract. */
  ocr(documentFixtureId: string): unknown;
  /**
   * When true, the engine emits a deliberately *wrong* output (malformed schema / missing citation)
   * for the "prove the red" self-test (S2) — so an injected regression makes the gate go red
   * deterministically. Off for the real golden-set run.
   */
  readonly injectRegression?: boolean;
}
