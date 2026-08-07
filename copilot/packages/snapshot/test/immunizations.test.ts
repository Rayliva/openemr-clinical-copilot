import { describe, it, expect } from "vitest";
import { mapFhirImmunizations } from "../src/immunizations.js";

const FETCHED = new Date("2026-07-10T12:00:00Z");

describe("mapFhirImmunizations", () => {
  it("maps a completed immunization with vaccine name, status, date, and provenance", () => {
    const bundle = {
      resourceType: "Bundle",
      entry: [
        {
          resource: {
            resourceType: "Immunization",
            id: "imm-1",
            status: "completed",
            vaccineCode: {
              coding: [{ system: "http://hl7.org/fhir/sid/cvx", code: "140", display: "Influenza, injectable" }],
            },
            occurrenceDateTime: "2025-10-01",
          },
        },
      ],
    };
    const [imm] = mapFhirImmunizations(bundle, FETCHED);
    expect(imm!.vaccine).toBe("Influenza, injectable");
    expect(imm!.status).toBe("completed");
    expect(imm!.date).toBe("2025-10-01");
    expect(imm!.provenance.sourceTable).toBe("immunizations");
    expect(imm!.provenance.rowUuid).toBe("imm-1");
  });

  it("falls back to the CVX code when no display is present (never dropped)", () => {
    const bundle = {
      resourceType: "Bundle",
      entry: [
        {
          resource: {
            resourceType: "Immunization",
            id: "imm-2",
            status: "completed",
            vaccineCode: { coding: [{ system: "http://hl7.org/fhir/sid/cvx", code: "115" }] },
          },
        },
      ],
    };
    expect(mapFhirImmunizations(bundle, FETCHED)[0]!.vaccine).toBe("115");
  });

  it("returns an empty list for an empty bundle", () => {
    expect(mapFhirImmunizations({ resourceType: "Bundle", total: 0 }, FETCHED)).toEqual([]);
  });
});
