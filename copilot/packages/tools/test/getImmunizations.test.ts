import { describe, it, expect, vi } from "vitest";
import { createGetImmunizations } from "../src/getImmunizations.js";

const FETCHED = new Date("2026-07-10T12:00:00Z");

function fakeFhir(bundle: unknown) {
  return { search: vi.fn(async () => bundle) };
}

describe("getImmunizations", () => {
  it("returns documented immunizations with provenance when present", async () => {
    const fhir = fakeFhir({
      resourceType: "Bundle",
      entry: [
        {
          resource: {
            resourceType: "Immunization",
            id: "imm-1",
            status: "completed",
            vaccineCode: { coding: [{ code: "140", display: "Influenza, injectable" }] },
            occurrenceDateTime: "2025-10-01",
          },
        },
      ],
    });
    const tool = createGetImmunizations({ fhir, clock: () => FETCHED });

    const res = await tool({ patientId: "rosa" });

    expect(fhir.search).toHaveBeenCalledWith("Immunization", { patient: "rosa" });
    expect(res.documented).toBe(true);
    if (res.documented) {
      expect(res.immunizations[0]!.vaccine).toBe("Influenza, injectable");
    }
  });

  it("returns documented:false for an empty bundle (none on file, not 'up to date')", async () => {
    const tool = createGetImmunizations({ fhir: fakeFhir({ resourceType: "Bundle", total: 0 }), clock: () => FETCHED });
    expect(await tool({ patientId: "x" })).toEqual({ documented: false });
  });

  it("rejects invalid input (empty patientId)", async () => {
    const tool = createGetImmunizations({ fhir: fakeFhir({ resourceType: "Bundle" }), clock: () => FETCHED });
    await expect(tool({ patientId: "" })).rejects.toThrow();
  });
});
