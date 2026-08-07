import { describe, expect, it } from "vitest";
import { toEvidenceIndex } from "../src/graph/evidenceIndex.js";
import type { AssembledFacts } from "../src/graph/types.js";

const FETCHED = "2026-07-10T00:00:00.000Z";

function facts(partial: Partial<AssembledFacts>): AssembledFacts {
  return {
    demographics: null,
    problems: null,
    medications: null,
    allergies: null,
    immunizations: null,
    vitals: null,
    labs: null,
    unavailableSources: [],
    ...partial,
  };
}

describe("toEvidenceIndex — medication evidence (grounding parity)", () => {
  // The generate step renders a med claim with dose/sig/date (renderMedications), so the
  // judge's evidence for the same cited row must carry those fields — otherwise a true,
  // dosed, dated claim is judged ungrounded, regenerated, and dropped.
  it("includes dose, sig, and prescription date for a dosed, dated med", () => {
    const rowUuid = "rx-1";
    const f = facts({
      medications: {
        documented: true,
        medications: [
          {
            drug: "Sumatriptan",
            status: "active",
            hasConflict: false,
            provenance: [{ sourceTable: "prescriptions", rowUuid, fetchedAt: FETCHED }],
            sources: [
              {
                drug: "Sumatriptan",
                sourceTable: "prescriptions",
                status: "active",
                active: true,
                provenance: { sourceTable: "prescriptions", rowUuid, fetchedAt: FETCHED },
                dosage: { dose: "50 mg", text: "PRN" },
                authoredOn: "2026-07-10",
              },
            ],
          },
        ],
      },
    });

    const evidence = toEvidenceIndex(f)[rowUuid];
    expect(evidence).toBeDefined();
    expect(evidence).toContain("Sumatriptan");
    expect(evidence).toContain("50 mg"); // dose
    expect(evidence).toContain("PRN"); // sig
    expect(evidence).toContain("2026-07-10"); // prescription date
  });

  it("includes allergy criticality so a 'high criticality' claim can ground", () => {
    // generate's renderAllergies emits ", criticality high"; the evidence must carry it too,
    // else the grounding judge drops the (true) claim — the same drift the dosage bug had.
    const rowUuid = "alg-1";
    const f = facts({
      allergies: {
        documented: true,
        allergies: [
          {
            substance: "Penicillin",
            criticality: "high",
            provenance: { sourceTable: "lists", rowUuid, fetchedAt: FETCHED },
          },
        ],
      },
    });
    const evidence = toEvidenceIndex(f)[rowUuid];
    expect(evidence).toBeDefined();
    expect(evidence).toContain("Penicillin");
    expect(evidence).toContain("high"); // criticality
  });

  it("includes immunization status so a 'completed' claim can ground", () => {
    const rowUuid = "imm-1";
    const f = facts({
      immunizations: {
        documented: true,
        immunizations: [
          {
            vaccine: "Influenza",
            status: "completed",
            date: "2025-10-01",
            provenance: { sourceTable: "immunizations", rowUuid, fetchedAt: FETCHED },
          },
        ],
      },
    });
    const evidence = toEvidenceIndex(f)[rowUuid];
    expect(evidence).toBeDefined();
    expect(evidence).toContain("Influenza");
    expect(evidence).toContain("completed"); // status
    expect(evidence).toContain("2025-10-01"); // date
  });

  it("omits dosage/date cleanly when the row has none (no invented fields)", () => {
    const rowUuid = "rx-2";
    const f = facts({
      medications: {
        documented: true,
        medications: [
          {
            drug: "Aspirin",
            status: "active",
            hasConflict: false,
            provenance: [{ sourceTable: "lists", rowUuid, fetchedAt: FETCHED }],
            sources: [
              {
                drug: "Aspirin",
                sourceTable: "lists",
                status: "active",
                active: true,
                provenance: { sourceTable: "lists", rowUuid, fetchedAt: FETCHED },
              },
            ],
          },
        ],
      },
    });

    const evidence = toEvidenceIndex(f)[rowUuid];
    expect(evidence).toBeDefined();
    expect(evidence).toContain("Aspirin");
    expect(evidence).not.toContain("dose");
    expect(evidence).not.toContain("dated");
  });
});
