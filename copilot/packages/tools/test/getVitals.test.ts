import { describe, it, expect, vi } from "vitest";
import { createGetVitals } from "../src/getVitals.js";
import { createGetLabs } from "../src/getLabs.js";

const FETCHED = new Date("2026-07-08T12:00:00Z");

function fakeFhir(bundle: unknown) {
  return { search: vi.fn(async () => bundle) };
}

const vitalsBundle = {
  resourceType: "Bundle",
  entry: [
    {
      resource: {
        resourceType: "Observation",
        id: "hr1",
        code: { coding: [{ code: "8867-4", display: "Heart rate" }] },
        effectiveDateTime: "2026-06-01T10:00:00Z",
        valueQuantity: { value: 72, unit: "/min" },
      },
    },
  ],
};

describe("getVitals", () => {
  it("queries Observation with the vital-signs category and returns documented readings", async () => {
    const fhir = fakeFhir(vitalsBundle);
    const tool = createGetVitals({ fhir, clock: () => FETCHED });

    const res = await tool({ patientId: "susan" });

    expect(fhir.search).toHaveBeenCalledWith("Observation", { patient: "susan", category: "vital-signs" });
    expect(res.documented).toBe(true);
    if (res.documented) {
      expect(res.observations[0]).toMatchObject({ name: "Heart rate", value: "72", unit: "/min" });
      expect(res.observations[0]!.provenance.sourceTable).toBe("form_vitals");
    }
  });

  it("returns documented:false when no vitals are on file (not 'normal')", async () => {
    const tool = createGetVitals({ fhir: fakeFhir({ resourceType: "Bundle", total: 0 }), clock: () => FETCHED });
    expect(await tool({ patientId: "x" })).toEqual({ documented: false });
  });

  it("rejects invalid input (empty patientId)", async () => {
    const tool = createGetVitals({ fhir: fakeFhir({ resourceType: "Bundle" }), clock: () => FETCHED });
    await expect(tool({ patientId: "" })).rejects.toThrow();
  });
});

describe("getLabs", () => {
  it("queries Observation with the laboratory category, source procedure_result", async () => {
    const fhir = fakeFhir({
      resourceType: "Bundle",
      entry: [
        {
          resource: {
            resourceType: "Observation",
            id: "a1c",
            code: { coding: [{ code: "4548-4", display: "Hemoglobin A1c" }] },
            effectiveDateTime: "2026-05-01T10:00:00Z",
            valueQuantity: { value: 6.4, unit: "%" },
          },
        },
      ],
    });
    const tool = createGetLabs({ fhir, clock: () => FETCHED });

    const res = await tool({ patientId: "susan" });

    expect(fhir.search).toHaveBeenCalledWith("Observation", { patient: "susan", category: "laboratory" });
    expect(res.documented).toBe(true);
    if (res.documented) {
      expect(res.observations[0]).toMatchObject({ name: "Hemoglobin A1c", value: "6.4", unit: "%" });
      expect(res.observations[0]!.provenance.sourceTable).toBe("procedure_result");
    }
  });

  it("returns documented:false when no labs are on file (a missing lab is not a normal lab)", async () => {
    const tool = createGetLabs({ fhir: fakeFhir({ resourceType: "Bundle", total: 0 }), clock: () => FETCHED });
    expect(await tool({ patientId: "x" })).toEqual({ documented: false });
  });
});
