import { describe, it, expect } from "vitest";
import { computeAge, mapFhirPatient } from "../src/patient.js";

describe("computeAge (patient-age spec)", () => {
  it.each([
    // birthDate, asOf, expected — AC1..AC4
    ["1971-11-05", "2026-07-10", 54], // birthday not yet reached this year
    ["1971-05-01", "2026-07-10", 55], // birthday already passed
    ["2000-07-10", "2026-07-10", 26], // birthday is the as-of date -> counts
    ["2000-07-11", "2026-07-10", 25], // day before birthday
    ["1971", "2026-07-10", null], // partial (year only) -> undefined
    ["1971-05", "2026-07-10", null], // partial (year-month) -> undefined
    ["not-a-date", "2026-07-10", null], // unparseable
    ["2030-01-01", "2026-07-10", null], // future DOB
  ] as const)("age(%s) as of %s -> %s", (birthDate, asOf, expected) => {
    expect(computeAge(birthDate, new Date(`${asOf}T12:00:00Z`))).toBe(expected);
  });
});

describe("mapFhirPatient — age (patient-age spec)", () => {
  const base = {
    resourceType: "Patient",
    id: "pid-1",
    name: [{ use: "official", family: "Alvarez", given: ["Rosa"] }],
    gender: "female",
  };

  it("attaches the derived age as of fetchedAt (AC1)", () => {
    const p = mapFhirPatient({ ...base, birthDate: "1971-11-05" }, new Date("2026-07-10T12:00:00Z"));
    expect(p.age).toBe(54);
  });

  it("leaves age undefined for a partial birthDate (AC4)", () => {
    const p = mapFhirPatient({ ...base, birthDate: "1971" }, new Date("2026-07-10T12:00:00Z"));
    expect(p.age).toBeUndefined();
    expect(p.birthDate).toBe("1971"); // DOB still surfaced as-is
  });

  it("leaves age undefined when there is no birthDate", () => {
    const p = mapFhirPatient(base, new Date("2026-07-10T12:00:00Z"));
    expect(p.age).toBeUndefined();
  });
});
