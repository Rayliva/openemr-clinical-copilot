import { describe, it, expect } from "vitest";
import { mapFhirObservations, mapAndCollectObservations } from "../src/index.js";

const FETCHED = new Date("2026-07-08T12:00:00Z");

const leaf = (id: string, code: string, display: string, value: number, unit: string, when: string): unknown => ({
  resourceType: "Observation",
  id,
  code: { coding: [{ system: "http://loinc.org", code, display }] },
  effectiveDateTime: when,
  valueQuantity: { value, unit },
});

const bundle = (resources: unknown[]): unknown => ({
  resourceType: "Bundle",
  type: "searchset",
  entry: resources.map((resource) => ({ resource })),
});

describe("mapFhirObservations", () => {
  it("maps a leaf valueQuantity to a reading with normalized unit, date, and LOINC code", () => {
    const [r] = mapFhirObservations(bundle([leaf("v1", "29463-7", "Body weight", 150, "lb_av", "2026-06-01T10:00:00Z")]), "form_vitals", FETCHED);
    expect(r).toMatchObject({ name: "Body weight", value: "150", unit: "lb", effectiveDateTime: "2026-06-01T10:00:00Z", code: "29463-7" });
    expect(r!.provenance).toEqual({ sourceTable: "form_vitals", rowUuid: "v1", fetchedAt: "2026-07-08T12:00:00.000Z" });
  });

  it("normalizes common UCUM units", () => {
    const readings = mapFhirObservations(
      bundle([
        leaf("a", "8867-4", "Heart rate", 99, "/min", "2026-06-01T10:00:00Z"),
        leaf("b", "8310-5", "Body Temperature", 99, "degF", "2026-06-01T10:00:00Z"),
        leaf("c", "39156-5", "Body mass index (BMI) [Ratio]", 29.3, "kg/m2", "2026-06-01T10:00:00Z"),
      ]),
      "form_vitals",
      FETCHED,
    );
    expect(readings.map((r) => `${r.value}${r.unit ?? ""}`)).toEqual(["99/min", "99°F", "29.3kg/m²"]);
  });

  it("combines blood-pressure components into one systolic/diastolic reading", () => {
    const bp = {
      resourceType: "Observation",
      id: "bp1",
      code: { coding: [{ system: "http://loinc.org", code: "85354-9", display: "Blood pressure systolic and diastolic" }] },
      effectiveDateTime: "2026-06-01T10:00:00Z",
      component: [
        { code: { coding: [{ code: "8480-6", display: "Systolic blood pressure" }] }, valueQuantity: { value: 150, unit: "mm[Hg]" } },
        { code: { coding: [{ code: "8462-4", display: "Diastolic blood pressure" }] }, valueQuantity: { value: 80, unit: "mm[Hg]" } },
      ],
    };
    const [r] = mapFhirObservations(bundle([bp]), "form_vitals", FETCHED);
    expect(r).toMatchObject({ name: "Blood pressure", value: "150/80", unit: "mmHg", code: "85354-9" });
  });

  it("skips panels (hasMember, no value) and value-less leaves", () => {
    const panel = {
      resourceType: "Observation",
      id: "panel",
      code: { coding: [{ code: "85353-1", display: "Vital signs panel" }] },
      effectiveDateTime: "2026-06-01T10:00:00Z",
      hasMember: [{ reference: "Observation/x" }],
    };
    const valueless = { resourceType: "Observation", id: "loc", code: { coding: [{ code: "8327-9", display: "Temperature Location" }] } };
    const readings = mapFhirObservations(bundle([panel, valueless, leaf("hr", "8867-4", "Heart rate", 99, "/min", "2026-06-01T10:00:00Z")]), "form_vitals", FETCHED);
    expect(readings.map((r) => r.name)).toEqual(["Heart rate"]);
  });
});

describe("mapAndCollectObservations (absence-aware, most-recent-per-type)", () => {
  it("keeps only the most recent reading per type", () => {
    const res = mapAndCollectObservations(
      bundle([
        leaf("old", "29463-7", "Body weight", 160, "lb_av", "2025-01-01T10:00:00Z"),
        leaf("new", "29463-7", "Body weight", 150, "lb_av", "2026-06-01T10:00:00Z"),
      ]),
      "form_vitals",
      FETCHED,
    );
    expect(res.documented).toBe(true);
    if (res.documented) {
      expect(res.observations).toHaveLength(1);
      expect(res.observations[0]).toMatchObject({ value: "150", effectiveDateTime: "2026-06-01T10:00:00Z" });
    }
  });

  it("returns documented:false for an empty bundle (absence, not 'normal')", () => {
    expect(mapAndCollectObservations(bundle([]), "procedure_result", FETCHED)).toEqual({ documented: false });
  });
});
