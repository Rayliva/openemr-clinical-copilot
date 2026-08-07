import { describe, it, expect, vi } from "vitest";
import { createGetMedications } from "../src/getMedications.js";

const FETCHED = new Date("2026-07-08T12:00:00Z");

const SUSAN_MEDS = {
  resourceType: "Bundle",
  entry: [
    { resource: { resourceType: "MedicationRequest", id: "rx-lis", status: "active", intent: "order", medicationCodeableConcept: { text: "Lisinopril" } } },
    { resource: { resourceType: "MedicationRequest", id: "list-lis", status: "stopped", intent: "plan", medicationCodeableConcept: { text: "Lisinopril" } } },
    { resource: { resourceType: "MedicationRequest", id: "list-met", status: "active", intent: "plan", medicationCodeableConcept: { text: "Metformin" } } },
  ],
};

function fakeFhir(bundle: unknown) {
  return { search: vi.fn(async () => bundle) };
}

describe("getMedications", () => {
  it("returns documented reconciled meds and flags the Lisinopril conflict", async () => {
    const fhir = fakeFhir(SUSAN_MEDS);
    const tool = createGetMedications({ fhir, clock: () => FETCHED });

    const res = await tool({ patientId: "susan" });

    expect(fhir.search).toHaveBeenCalledWith("MedicationRequest", { patient: "susan" });
    expect(res.documented).toBe(true);
    if (res.documented) {
      const lisinopril = res.medications.find((m) => m.drug === "Lisinopril")!;
      expect(lisinopril.status).toBe("conflicted");
      expect(lisinopril.provenance).toHaveLength(2);
    }
  });

  it("returns documented:false for an empty bundle (absence, not 'no meds')", async () => {
    const tool = createGetMedications({ fhir: fakeFhir({ resourceType: "Bundle", entry: [] }), clock: () => FETCHED });
    expect(await tool({ patientId: "x" })).toEqual({ documented: false });
  });

  it("rejects invalid input (empty patientId)", async () => {
    const tool = createGetMedications({ fhir: fakeFhir({ resourceType: "Bundle" }), clock: () => FETCHED });
    await expect(tool({ patientId: "" })).rejects.toThrow();
  });
});
