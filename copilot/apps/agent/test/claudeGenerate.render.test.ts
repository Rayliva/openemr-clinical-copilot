import { describe, expect, it } from "vitest";
import { renderDocuments, renderFacts } from "../src/graph/claudeGenerate.js";
import type { AssembledFacts, IntakeDocument } from "../src/graph/types.js";

const FETCHED = "2026-07-10T00:00:00.000Z";
const prov = (rowUuid: string, sourceTable: string) => ({ sourceTable, rowUuid, fetchedAt: FETCHED });

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

describe("renderFacts — safety framing (absence ≠ negative)", () => {
  it("marks a FAILED read as unavailable, explicitly NOT an absence", () => {
    const out = renderFacts(facts({ unavailableSources: ["medications"] }));
    expect(out).toContain("UNAVAILABLE SOURCES: medications");
    expect(out).toContain("NOT an absence");
    expect(out).toContain("cannot confirm");
    // Must forbid the model from reading the failure as "none documented".
    expect(out.toLowerCase()).toContain("never report it as");
  });

  it("frames a documented:false MEDICATIONS list as unknown, not confirmed-none", () => {
    const out = renderFacts(facts({ medications: { documented: false } }));
    expect(out).toContain("none documented");
    expect(out).toContain("not confirmed none");
  });

  it("frames absent ALLERGIES as unknown, never 'no allergies' or 'safe'", () => {
    const out = renderFacts(facts({ allergies: { documented: false } }));
    expect(out).toContain("treat as unknown");
    expect(out).toMatch(/NOT as 'no allergies' or 'safe'/);
  });

  it("frames absent LABS/VITALS as 'none documented', never 'normal'", () => {
    expect(renderFacts(facts({ labs: { documented: false } }))).toContain("not a normal lab");
    expect(renderFacts(facts({ vitals: { documented: false } }))).toContain("NOT as 'normal'");
  });

  it("frames absent PROBLEMS and IMMUNIZATIONS without over-claiming", () => {
    expect(renderFacts(facts({ problems: { documented: false } }))).toContain("NOT as 'no problems'");
    expect(renderFacts(facts({ immunizations: { documented: false } }))).toContain(
      "do NOT compute which vaccines are missing",
    );
  });

  it("returns an explicit 'nothing retrieved' sentinel when no facts are present", () => {
    expect(renderFacts(facts({}))).toBe("No patient record was retrieved for this request.");
  });
});

describe("renderFacts — source-id tagging + field passthrough", () => {
  it("tags every documented fact with its [source id: …] (the citation gate depends on it)", () => {
    const out = renderFacts(
      facts({
        demographics: { id: "p1", name: "Rosa Alvarez", birthDate: "1971-11-05", age: 54, provenance: prov("demo-1", "patient_data") },
        problems: { documented: true, problems: [{ display: "Acute sinusitis", provenance: prov("prob-1", "lists") }] },
      }),
    );
    expect(out).toContain("[source id: demo-1]");
    expect(out).toContain("[source id: prob-1]");
    expect(out).toContain("age: 54 years");
  });
});

describe("renderDocuments — on-file documents block (W2 intake extractor)", () => {
  const doc = (rowUuid: string, title: string, docType: IntakeDocument["docType"]): IntakeDocument => ({
    title,
    docType,
    provenance: prov(rowUuid, "documents"),
  });

  it("emits NO block when documents are undefined (the worker never ran — chart-only turn)", () => {
    expect(renderDocuments(undefined)).toBe("");
  });

  it("reports 'none on file' when the worker ran but found nothing — never a fabricated document", () => {
    const out = renderDocuments([]);
    expect(out.toLowerCase()).toContain("none on file");
    expect(out).toContain("NOT as a fabricated document");
    // A documented absence, not a chart finding of "no documents".
    expect(out).not.toContain("[source id:");
  });

  it("tags each on-file document with its DocumentReference [source id: …] so a claim can cite it", () => {
    const out = renderDocuments([
      doc("docref-1", "New Patient Intake Form", "intake_form"),
      doc("docref-2", "CBC Results 2026", "lab_pdf"),
    ]);
    expect(out).toContain("[source id: docref-1]");
    expect(out).toContain("New Patient Intake Form");
    expect(out).toContain("intake_form");
    expect(out).toContain("[source id: docref-2]");
    expect(out).toContain("CBC Results 2026");
    // Must warn against merging a document id with a chart/guideline id in one claim.
    expect(out.toLowerCase()).toContain("never mix");
  });
});

describe("renderFacts — medication dose passthrough (moved from above)", () => {
  it("renders med dose + authoredOn when present, and nothing invented when absent", () => {
    const withDose = renderFacts(
      facts({
        medications: {
          documented: true,
          medications: [
            {
              drug: "Amoxicillin",
              status: "active",
              hasConflict: false,
              provenance: [prov("rx-1", "prescriptions")],
              sources: [
                {
                  drug: "Amoxicillin",
                  sourceTable: "prescriptions",
                  status: "active",
                  active: true,
                  provenance: prov("rx-1", "prescriptions"),
                  dosage: { dose: "500 mg", text: "TID" },
                  authoredOn: "2026-07-11",
                },
              ],
            },
          ],
        },
      }),
    );
    expect(withDose).toContain("dose 500 mg");
    expect(withDose).toContain("dated 2026-07-11");
    expect(withDose).toContain("[source id: rx-1]");

    const noDose = renderFacts(
      facts({
        medications: {
          documented: true,
          medications: [
            {
              drug: "Aspirin",
              status: "active",
              hasConflict: false,
              provenance: [prov("rx-2", "lists")],
              sources: [
                { drug: "Aspirin", sourceTable: "lists", status: "active", active: true, provenance: prov("rx-2", "lists") },
              ],
            },
          ],
        },
      }),
    );
    expect(noDose).not.toContain("dose ");
    expect(noDose).not.toContain("dated ");
    expect(noDose).not.toContain("undefined");
  });
});
