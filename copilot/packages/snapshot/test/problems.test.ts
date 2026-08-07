import { describe, it, expect } from "vitest";
import { mapFhirCondition, mapFhirConditions } from "../src/problems.js";

const FETCHED = new Date("2026-07-08T12:00:00Z");

describe("mapFhirCondition", () => {
  it("maps display, clinicalStatus, and provenance (lists)", () => {
    const c = mapFhirCondition(
      {
        resourceType: "Condition",
        id: "cid",
        code: { text: "diabetes" },
        clinicalStatus: { coding: [{ code: "active" }] },
      },
      FETCHED,
    );
    expect(c.display).toBe("diabetes");
    expect(c.clinicalStatus).toBe("active");
    expect(c.provenance).toEqual({
      sourceTable: "lists",
      rowUuid: "cid",
      fetchedAt: "2026-07-08T12:00:00.000Z",
    });
  });

  it("falls back to a coding display when text is absent", () => {
    const c = mapFhirCondition(
      { resourceType: "Condition", id: "x", code: { coding: [{ display: "Chronic kidney disease" }] } },
      FETCHED,
    );
    expect(c.display).toBe("Chronic kidney disease");
    expect(c.clinicalStatus).toBeUndefined();
  });

  it("throws on a malformed resource", () => {
    expect(() => mapFhirCondition({ resourceType: "Patient", id: "x" }, FETCHED)).toThrow();
  });
});

describe("mapFhirConditions", () => {
  it("maps a searchset bundle to a list", () => {
    const list = mapFhirConditions(
      {
        resourceType: "Bundle",
        entry: [
          { resource: { resourceType: "Condition", id: "1", code: { text: "diabetes" } } },
          { resource: { resourceType: "Condition", id: "2", code: { text: "hypertension" } } },
        ],
      },
      FETCHED,
    );
    expect(list.map((p) => p.display)).toEqual(["diabetes", "hypertension"]);
  });

  it("returns [] for an empty or entry-less bundle", () => {
    expect(mapFhirConditions({ resourceType: "Bundle", entry: [] }, FETCHED)).toEqual([]);
    expect(mapFhirConditions({ resourceType: "Bundle" }, FETCHED)).toEqual([]);
  });
});
