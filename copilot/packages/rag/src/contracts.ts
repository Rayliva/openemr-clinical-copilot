import { z } from "zod";

/**
 * A retrievable unit of a guideline document, with its provenance. Guideline evidence is a
 * DISTINCT kind of fact from the patient record — it is never merged with a chart claim
 * (`provenance-and-grounding`, `w2-multi-agent-orchestration`).
 */
export const GuidelineChunk = z.object({
  chunkId: z.string().min(1),
  doc: z.string().min(1),
  section: z.string().min(1),
  page: z.number().int().min(1).optional(),
  text: z.string().min(1),
});
export type GuidelineChunk = z.infer<typeof GuidelineChunk>;

/** A retrieved + scored chunk — the only guideline material the answer model sees, with metadata. */
export const EvidenceSnippet = z.object({
  chunkId: z.string().min(1),
  doc: z.string().min(1),
  section: z.string().min(1),
  page: z.number().int().min(1).optional(),
  text: z.string().min(1),
  score: z.number(),
});
export type EvidenceSnippet = z.infer<typeof EvidenceSnippet>;
