import { describe, it, expect, vi } from "vitest";
import { createGetAllergies } from "../src/getAllergies.js";

const FETCHED = new Date("2026-07-08T12:00:00Z");

function fakeFhir(bundle: unknown) {
  return { search: vi.fn(async () => bundle) };
}

describe("getAllergies", () => {
  it("returns documented allergies with provenance when present", async () => {
    const fhir = fakeFhir({
      resourceType: "Bundle",
      entry: [{ resource: { resourceType: "AllergyIntolerance", id: "a1", code: { text: "Penicillin" }, criticality: "high" } }],
    });
    const tool = createGetAllergies({ fhir, clock: () => FETCHED });

    const res = await tool({ patientId: "susan" });

    expect(fhir.search).toHaveBeenCalledWith("AllergyIntolerance", { patient: "susan" });
    expect(res.documented).toBe(true);
    if (res.documented) {
      expect(res.allergies[0]!.substance).toBe("Penicillin");
    }
  });

  it("returns documented:false for Susan's empty bundle (unknown, NOT 'no allergies/safe')", async () => {
    const tool = createGetAllergies({ fhir: fakeFhir({ resourceType: "Bundle", total: 0 }), clock: () => FETCHED });
    expect(await tool({ patientId: "susan" })).toEqual({ documented: false });
  });

  it("rejects invalid input (empty patientId)", async () => {
    const tool = createGetAllergies({ fhir: fakeFhir({ resourceType: "Bundle" }), clock: () => FETCHED });
    await expect(tool({ patientId: "" })).rejects.toThrow();
  });
});
