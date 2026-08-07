/**
 * Rubric scorer — `schema_valid` (deterministic regression-catcher).
 *
 * Spec (per `docs/specs/w2-eval-gate.md` + the `w2-eval-gate` rule): a case that exercises
 * `schema_valid` passes iff its captured `output.structured` DTO parses clean against the matching
 * Zod schema. Branch on `output.kind`:
 *   - `ingestion` → the canonical ingestion draft schema, discriminated on `docType`
 *     (`lab_pdf` → `LabPdfExtraction`, `intake_form` → `IntakeFormExtraction`).
 *   - `chat` → there is no dedicated chat-response Zod contract in the frozen packages yet
 *     (`@copilot/tools` exports per-tool result types, not a composed chat DTO). We validate the
 *     minimal shape the harness relies on (atomic claims + their source refs) with a local schema.
 *     ASSUMPTION flagged for the runner slice (T4): tighten this to the real chat-response schema
 *     once one exists.
 *
 * Pure + total: no IO, no clock, no randomness — `safeParse` never throws. A scorer reports ONLY the
 * category it measures, and ONLY when the case lists it (`goldenCase.category`); otherwise `{}`.
 */

import { z } from "zod";
import { LabPdfExtraction, IntakeFormExtraction } from "@copilot/ingestion";
import type { CaseRunOutput, GoldenCase, RubricScorer } from "../contracts.js";

/** Ingestion drafts are one of the two canonical extraction schemas, keyed by `docType`. */
const IngestionDraftSchema = z.discriminatedUnion("docType", [LabPdfExtraction, IntakeFormExtraction]);

/**
 * Minimal chat-response shape the harness depends on until a canonical chat DTO is frozen: a text
 * body plus atomic claims, each with a statement and its source refs. Kept intentionally lenient
 * (no `.strict()`) so a richer real DTO still parses — this checks structure, not exhaustiveness.
 */
const ChatResponseDraftSchema = z.object({
  text: z.string(),
  citations: z.array(
    z.object({
      statement: z.string().min(1),
      sourceRefs: z.array(z.string()),
    }),
  ),
});

function structureParses(output: CaseRunOutput): boolean {
  const schema = output.kind === "ingestion" ? IngestionDraftSchema : ChatResponseDraftSchema;
  return schema.safeParse(output.structured).success;
}

export const schemaValidScorer: RubricScorer = (output: CaseRunOutput, goldenCase: GoldenCase) => {
  if (!goldenCase.category.includes("schema_valid")) {
    return {};
  }
  return { schema_valid: structureParses(output) };
};
