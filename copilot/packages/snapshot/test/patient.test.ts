import { describe, it, expect } from "vitest";
import { mapFhirPatient } from "../src/patient.js";

const FETCHED = new Date("2026-07-08T12:00:00Z");

// Shape taken from the live OpenEMR US-Core Patient for Susan Underwood.
const SUSAN = {
  resourceType: "Patient",
  id: "a2326abc-c03c-4b9e-8af9-b7e03a9b4362",
  name: [{ use: "official", family: "Underwood", given: ["Susan", "Ardmore"] }],
  gender: "female",
  birthDate: "1967-02-08",
};

describe("mapFhirPatient", () => {
  it("maps demographics and attaches provenance", () => {
    const p = mapFhirPatient(SUSAN, FETCHED);
    expect(p.id).toBe("a2326abc-c03c-4b9e-8af9-b7e03a9b4362");
    expect(p.name).toBe("Susan Ardmore Underwood");
    expect(p.gender).toBe("female");
    expect(p.birthDate).toBe("1967-02-08");
    expect(p.provenance).toEqual({
      sourceTable: "patient_data",
      rowUuid: "a2326abc-c03c-4b9e-8af9-b7e03a9b4362",
      fetchedAt: "2026-07-08T12:00:00.000Z",
    });
  });

  it("leaves absent optional fields undefined (absence is not guessed)", () => {
    const p = mapFhirPatient(
      { resourceType: "Patient", id: "x", name: [{ family: "Doe" }] },
      FETCHED,
    );
    expect(p.name).toBe("Doe");
    expect(p.birthDate).toBeUndefined();
    expect(p.gender).toBeUndefined();
  });

  it("has no name when none is documented (absence, not a guess)", () => {
    const p = mapFhirPatient({ resourceType: "Patient", id: "x" }, FETCHED);
    expect(p.name).toBeUndefined();
  });

  it("prefers the official name entry", () => {
    const p = mapFhirPatient(
      {
        resourceType: "Patient",
        id: "x",
        name: [
          { use: "nickname", given: ["Sue"] },
          { use: "official", family: "Underwood", given: ["Susan"] },
        ],
      },
      FETCHED,
    );
    expect(p.name).toBe("Susan Underwood");
  });

  it("throws a typed error on a non-Patient / malformed resource", () => {
    expect(() => mapFhirPatient({ resourceType: "Observation", id: "x" }, FETCHED)).toThrow();
  });
});
