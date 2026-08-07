import { describe, it, expect, vi } from "vitest";
import { createGetProblems } from "../src/getProblems.js";

const FETCHED = new Date("2026-07-08T12:00:00Z");

function fakeFhir(bundle: unknown) {
  return { search: vi.fn(async () => bundle) };
}

describe("getProblems", () => {
  it("returns documented problems with provenance when present", async () => {
    const fhir = fakeFhir({
      resourceType: "Bundle",
      entry: [
        {
          resource: {
            resourceType: "Condition",
            id: "c1",
            code: { text: "Type 2 diabetes mellitus" },
            clinicalStatus: { coding: [{ code: "active" }] },
          },
        },
      ],
    });
    const tool = createGetProblems({ fhir, clock: () => FETCHED });

    const res = await tool({ patientId: "marcus" });

    expect(fhir.search).toHaveBeenCalledWith("Condition", { patient: "marcus" });
    expect(res.documented).toBe(true);
    if (res.documented) {
      expect(res.problems[0]!.display).toBe("Type 2 diabetes mellitus");
      expect(res.problems[0]!.provenance.sourceTable).toBe("lists");
    }
  });

  it("returns documented:false for an empty bundle (no problems on file, not 'healthy')", async () => {
    const tool = createGetProblems({ fhir: fakeFhir({ resourceType: "Bundle", total: 0 }), clock: () => FETCHED });
    expect(await tool({ patientId: "x" })).toEqual({ documented: false });
  });

  it("rejects invalid input (empty patientId)", async () => {
    const tool = createGetProblems({ fhir: fakeFhir({ resourceType: "Bundle" }), clock: () => FETCHED });
    await expect(tool({ patientId: "" })).rejects.toThrow();
  });
});
