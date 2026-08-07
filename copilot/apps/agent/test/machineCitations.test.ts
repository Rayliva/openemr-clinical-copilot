import { describe, it, expect } from "vitest";
import type { EvidenceSnippet } from "@copilot/rag";
import type { Provenance } from "@copilot/snapshot";
import { buildClaimCitations, toProvenanceTableIndex } from "../src/graph/machineCitations.js";
import type { AssembledFacts, IntakeDocument } from "../src/graph/types.js";

const prov = (sourceTable: string, rowUuid: string): Provenance => ({
  sourceTable,
  rowUuid,
  fetchedAt: "2026-07-17T00:00:00.000Z",
});

const snippet: EvidenceSnippet = {
  chunkId: "type2-diabetes::glycemic-targets::0",
  doc: "type2-diabetes-management",
  section: "Glycemic Targets",
  page: 2,
  text: "An A1c target below 7% is reasonable for most nonpregnant adults.",
  score: 0.9,
};

const EMPTY_FACTS: AssembledFacts = {
  demographics: null,
  problems: null,
  medications: null,
  allergies: null,
  immunizations: null,
  vitals: null,
  labs: null,
  unavailableSources: [],
};

describe("buildClaimCitations — the 5-field machine citation contract", () => {
  it("emits all 5 snake_case fields for a chart claim, from provenance + evidence indexes", () => {
    const cites = buildClaimCitations(
      ["med-uuid-1"],
      [],
      { "med-uuid-1": "prescriptions" },
      { "med-uuid-1": "Medication: Lisinopril; status active; source prescriptions" },
    );
    expect(cites).toEqual([
      {
        source_type: "chart",
        source_id: "med-uuid-1",
        page_or_section: "prescriptions",
        field_or_chunk_id: "med-uuid-1",
        quote_or_value: "Medication: Lisinopril; status active; source prescriptions",
      },
    ]);
  });

  it("emits a guideline citation (with page) when the ref matches a retrieved chunk", () => {
    const cites = buildClaimCitations([snippet.chunkId], [snippet], {}, {});
    expect(cites[0]).toEqual({
      source_type: "guideline",
      source_id: "type2-diabetes-management",
      page_or_section: "Glycemic Targets (p.2)",
      field_or_chunk_id: snippet.chunkId,
      quote_or_value: snippet.text,
    });
  });

  it("omits the page suffix when the chunk has no page", () => {
    const noPage: EvidenceSnippet = { ...snippet, page: undefined };
    const cites = buildClaimCitations([noPage.chunkId], [noPage], {}, {});
    expect(cites[0]?.page_or_section).toBe("Glycemic Targets");
  });

  it("keeps chart and guideline refs distinct within one claim's citation list", () => {
    const cites = buildClaimCitations(
      ["prob-uuid", snippet.chunkId],
      [snippet],
      { "prob-uuid": "lists" },
      { "prob-uuid": "Problem: Type 2 diabetes (active)" },
    );
    expect(cites.map((c) => c.source_type)).toEqual(["chart", "guideline"]);
    expect(cites[0]?.page_or_section).toBe("lists");
  });

  it("falls back to page_or_section 'chart' and empty quote for an unindexed chart ref", () => {
    const cites = buildClaimCitations(["mystery-uuid"], [], {}, {});
    expect(cites[0]).toEqual({
      source_type: "chart",
      source_id: "mystery-uuid",
      page_or_section: "chart",
      field_or_chunk_id: "mystery-uuid",
      quote_or_value: "",
    });
  });
});

describe("toProvenanceTableIndex — rowUuid -> OpenEMR source table", () => {
  it("maps every fact group and both medication sources to its source table", () => {
    const facts: AssembledFacts = {
      ...EMPTY_FACTS,
      problems: { documented: true, problems: [{ display: "Type 2 diabetes", provenance: prov("lists", "prob-1") } as never] },
      medications: {
        documented: true,
        medications: [
          {
            drug: "Lisinopril",
            sources: [
              { provenance: prov("prescriptions", "rx-1") },
              { provenance: prov("lists", "list-1") },
            ],
          } as never,
        ],
      } as never,
      labs: { documented: true, observations: [{ name: "A1c", value: "8.1", provenance: prov("form_observation", "lab-1") } as never] },
    };
    const index = toProvenanceTableIndex(facts);
    expect(index).toEqual({
      "prob-1": "lists",
      "rx-1": "prescriptions",
      "list-1": "lists",
      "lab-1": "form_observation",
    });
  });

  it("indexes on-file documents by their DocumentReference table", () => {
    const documents: IntakeDocument[] = [
      { title: "Intake form", docType: "intake_form", provenance: prov("documents", "doc-1") },
    ];
    const index = toProvenanceTableIndex(EMPTY_FACTS, documents);
    expect(index["doc-1"]).toBe("documents");
  });

  it("returns an empty index for an empty chart", () => {
    expect(toProvenanceTableIndex(EMPTY_FACTS)).toEqual({});
  });
});
