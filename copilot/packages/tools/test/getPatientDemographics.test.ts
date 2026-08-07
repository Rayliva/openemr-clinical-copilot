import { describe, it, expect, vi } from "vitest";
import { createGetPatientDemographics } from "../src/getPatientDemographics.js";

const SUSAN = {
  resourceType: "Patient",
  id: "pid-1",
  name: [{ use: "official", family: "Underwood", given: ["Susan"] }],
  gender: "female",
  birthDate: "1967-02-08",
};
const FETCHED = new Date("2026-07-08T12:00:00Z");

function fakeFhir(bundle: unknown) {
  return { search: vi.fn(async () => bundle) };
}

describe("getPatientDemographics", () => {
  it("returns found:true with provenance-tagged demographics", async () => {
    const fhir = fakeFhir({ resourceType: "Bundle", entry: [{ resource: SUSAN }] });
    const tool = createGetPatientDemographics({ fhir, clock: () => FETCHED });

    const res = await tool({ patientId: "pid-1" });

    expect(res.found).toBe(true);
    if (res.found) {
      expect(res.demographics.name).toBe("Susan Underwood");
      expect(res.demographics.birthDate).toBe("1967-02-08");
      expect(res.demographics.provenance).toEqual({
        sourceTable: "patient_data",
        rowUuid: "pid-1",
        fetchedAt: "2026-07-08T12:00:00.000Z",
      });
    }
    expect(fhir.search).toHaveBeenCalledWith("Patient", { _id: "pid-1" });
  });

  it("returns found:false when no patient matches (no data on file, not a negative)", async () => {
    const fhir = fakeFhir({ resourceType: "Bundle", entry: [] });
    const tool = createGetPatientDemographics({ fhir, clock: () => FETCHED });

    const res = await tool({ patientId: "nope" });

    expect(res).toEqual({ found: false });
  });

  it("throws a typed mapping error (not a raw TypeError) on a non-Bundle body", async () => {
    // A null / non-object body from the FHIR endpoint must surface as a typed
    // SnapshotMappingError the graph can catch, not `Cannot read properties of null`.
    const fhir = fakeFhir(null);
    const tool = createGetPatientDemographics({ fhir, clock: () => FETCHED });

    await expect(tool({ patientId: "pid-1" })).rejects.toThrow(/bundle/i);
  });

  it("rejects invalid input (empty patientId)", async () => {
    const fhir = fakeFhir({ resourceType: "Bundle", entry: [] });
    const tool = createGetPatientDemographics({ fhir, clock: () => FETCHED });

    await expect(tool({ patientId: "" })).rejects.toThrow();
  });
});
