import type { EvidenceSnippet } from "@copilot/rag";
import type { Provenance } from "@copilot/snapshot";
import type { AssembledFacts, IntakeDocument } from "./types.js";

/**
 * The canonical machine-readable citation shape emitted at the `/chat` response boundary
 * (Week 2 Core Req 5). snake_case is the wire contract the graders check — the minimum shape
 * is `{source_type, source_id, page_or_section, field_or_chunk_id, quote_or_value}`. Both
 * chart-derived and guideline-derived claims carry it, tagged by `source_type` so a
 * patient-record fact is never conflated with a guideline recommendation.
 */
export interface MachineCitation {
  readonly source_type: "chart" | "guideline";
  /** The record/chunk identity — a chart row uuid, or the guideline corpus doc name. */
  readonly source_id: string;
  /** Chart: the OpenEMR source table. Guideline: the section, suffixed " (p.N)" when known. */
  readonly page_or_section: string;
  /** Chart: the row uuid. Guideline: the chunk id. */
  readonly field_or_chunk_id: string;
  /** Chart: the serialized fact content (what the grounding judge saw). Guideline: the passage. */
  readonly quote_or_value: string;
}

/**
 * Build the machine citation list for one claim's cited `sourceRefs`. A ref that matches a
 * retrieved guideline chunk (`EvidenceSnippet.chunkId`) becomes a `guideline` citation carrying
 * the passage; every other ref is a `chart` citation whose source table + serialized content come
 * from the provenance/evidence indexes. Pure + total: an unindexed chart ref degrades to
 * `page_or_section: "chart"` and an empty quote rather than throwing (it stays cited, never
 * fabricated).
 */
export function buildClaimCitations(
  sourceRefs: readonly string[],
  evidence: readonly EvidenceSnippet[],
  provenanceIndex: Record<string, string>,
  evidenceIndex: Record<string, string>,
): MachineCitation[] {
  const byChunk = new Map(evidence.map((e) => [e.chunkId, e]));
  return sourceRefs.map((ref): MachineCitation => {
    const snip = byChunk.get(ref);
    if (snip !== undefined) {
      const section = snip.page !== undefined ? `${snip.section} (p.${snip.page})` : snip.section;
      return {
        source_type: "guideline",
        source_id: snip.doc,
        page_or_section: section,
        field_or_chunk_id: snip.chunkId,
        quote_or_value: snip.text,
      };
    }
    return {
      source_type: "chart",
      source_id: ref,
      page_or_section: provenanceIndex[ref] ?? "chart",
      field_or_chunk_id: ref,
      quote_or_value: evidenceIndex[ref] ?? "",
    };
  });
}

/**
 * Pure projection from assembled facts (+ on-file documents) to `rowUuid -> OpenEMR source table`,
 * so a chart citation's `page_or_section` is resolved from real provenance (never parsed from
 * prose). Mirrors the fact groups `toEvidenceIndex` walks; medications contribute one entry per
 * source row (pre-reconciliation), since a claim cites that same per-source uuid.
 */
export function toProvenanceTableIndex(
  facts: AssembledFacts,
  documents: readonly IntakeDocument[] = [],
): Record<string, string> {
  const index: Record<string, string> = {};
  const put = (p: Provenance): void => {
    index[p.rowUuid] = p.sourceTable;
  };

  if (facts.demographics !== null) {
    put(facts.demographics.provenance);
  }
  const problems = facts.problems;
  if (problems !== null && problems.documented) {
    for (const problem of problems.problems) {
      put(problem.provenance);
    }
  }
  const medications = facts.medications;
  if (medications !== null && medications.documented) {
    for (const med of medications.medications) {
      for (const source of med.sources) {
        put(source.provenance);
      }
    }
  }
  const allergies = facts.allergies;
  if (allergies !== null && allergies.documented) {
    for (const allergy of allergies.allergies) {
      put(allergy.provenance);
    }
  }
  const immunizations = facts.immunizations;
  if (immunizations !== null && immunizations.documented) {
    for (const immunization of immunizations.immunizations) {
      put(immunization.provenance);
    }
  }
  const vitals = facts.vitals;
  if (vitals !== null && vitals.documented) {
    for (const vital of vitals.observations) {
      put(vital.provenance);
    }
  }
  const labs = facts.labs;
  if (labs !== null && labs.documented) {
    for (const lab of labs.observations) {
      put(lab.provenance);
    }
  }
  for (const document of documents) {
    put(document.provenance);
  }
  return index;
}
