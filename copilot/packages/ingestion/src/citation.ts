import { z } from "zod";

/** A [0,1]-normalized page coordinate. `.finite()` rejects NaN/±Infinity — without it a NaN
 * coordinate slips past `.min/.max` (every NaN comparison is false), producing a misleading box. */
const coord = z.number().finite().min(0).max(1);

/**
 * A bounding box on a document page, in [0,1]-normalized coordinates. `page` is 1-based.
 * Absent from a {@link Citation} when a tight box could not be located (the citation then
 * degrades to page/section — it is never dropped; see w2-document-ingestion-writes).
 */
export const BoundingBox = z.object({
  page: z.number().int().min(1),
  x: coord,
  y: coord,
  w: coord,
  h: coord,
});
export type BoundingBox = z.infer<typeof BoundingBox>;

/** The kinds of evidence a claim can cite. Documents, chart rows, and RAG chunks share one shape. */
export const CitationSourceType = z.enum(["lab_pdf", "intake_form", "medication_list", "referral_fax", "chart", "guideline"]);
export type CitationSourceType = z.infer<typeof CitationSourceType>;

/**
 * Machine-readable citation for one extracted value (PDF Core Req 5). camelCase in TS; a 1:1
 * snake_case wire form (`{source_type, source_id, page_or_section, field_or_chunk_id,
 * quote_or_value}`) is produced at the response boundary in a later slice.
 */
export const Citation = z.object({
  sourceType: CitationSourceType,
  sourceId: z.string().min(1),
  pageOrSection: z.string().min(1),
  fieldOrChunkId: z.string().min(1),
  /** The text the source shows (the VLM's quote_or_value; cross-checked against OCR). */
  quoteOrValue: z.string(),
  /** A tight bounding box, when one could be located. */
  locator: BoundingBox.optional(),
  /** True when the value was physician-edited (box points to the region; value differs from the page). */
  corrected: z.boolean().optional(),
});
export type Citation = z.infer<typeof Citation>;
