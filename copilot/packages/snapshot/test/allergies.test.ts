import { describe, it, expect } from "vitest";
import { mapFhirAllergies } from "../src/allergies.js";

const FETCHED = new Date("2026-07-08T12:00:00Z");

describe("mapFhirAllergies", () => {
  it("returns documented:true with mapped allergies when present", () => {
    const res = mapFhirAllergies(
      {
        resourceType: "Bundle",
        entry: [
          {
            resource: {
              resourceType: "AllergyIntolerance",
              id: "aid",
              code: { text: "Penicillin" },
              criticality: "high",
              clinicalStatus: { coding: [{ code: "active" }] },
            },
          },
        ],
      },
      FETCHED,
    );

    expect(res.documented).toBe(true);
    if (res.documented) {
      expect(res.allergies[0]).toMatchObject({
        substance: "Penicillin",
        criticality: "high",
        clinicalStatus: "active",
      });
      expect(res.allergies[0]!.provenance).toEqual({
        sourceTable: "lists",
        rowUuid: "aid",
        fetchedAt: "2026-07-08T12:00:00.000Z",
      });
    }
  });

  it("returns documented:false for an EMPTY bundle (absence, not 'none/safe')", () => {
    expect(mapFhirAllergies({ resourceType: "Bundle", entry: [] }, FETCHED)).toEqual({
      documented: false,
    });
    expect(mapFhirAllergies({ resourceType: "Bundle" }, FETCHED)).toEqual({ documented: false });
  });

  it("maps an allergy with missing reaction/severity (documented, but incomplete)", () => {
    const res = mapFhirAllergies(
      {
        resourceType: "Bundle",
        entry: [{ resource: { resourceType: "AllergyIntolerance", id: "a2", code: { text: "Penicillin" } } }],
      },
      FETCHED,
    );
    expect(res.documented).toBe(true);
    if (res.documented) {
      expect(res.allergies[0]!.substance).toBe("Penicillin");
      expect(res.allergies[0]!.criticality).toBeUndefined();
    }
  });

  it("throws on a malformed entry", () => {
    expect(() =>
      mapFhirAllergies(
        { resourceType: "Bundle", entry: [{ resource: { resourceType: "Condition", id: "x" } }] },
        FETCHED,
      ),
    ).toThrow();
  });
});
