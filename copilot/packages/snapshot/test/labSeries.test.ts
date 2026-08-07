import { describe, it, expect } from "vitest";
import { buildLabSeries } from "../src/index.js";

const AT = new Date("2026-07-17T00:00:00.000Z");

/** One FHIR Observation searchset entry (numeric valueQuantity). */
function obs(id: string, code: string, display: string, value: number, unit: string, date: string): unknown {
  return {
    resource: {
      resourceType: "Observation",
      id,
      code: { text: display, coding: [{ code, display }] },
      effectiveDateTime: date,
      valueQuantity: { value, unit },
    },
  };
}

function bundle(...entries: unknown[]): unknown {
  return { resourceType: "Bundle", type: "searchset", entry: entries };
}

describe("buildLabSeries — group extracted lab Observations into time series", () => {
  it("AC1: N readings of one test across N dates → one ascending N-point series; distinct tests split", () => {
    const b = bundle(
      obs("a2", "4548-4", "Hemoglobin A1c", 7.4, "%", "2026-04-15"),
      obs("a1", "4548-4", "Hemoglobin A1c", 8.1, "%", "2026-01-10"),
      obs("a3", "4548-4", "Hemoglobin A1c", 6.9, "%", "2026-07-04"),
      obs("e1", "48642-3", "eGFR", 62, "mL/min", "2026-01-10"),
      obs("e2", "48642-3", "eGFR", 68, "mL/min", "2026-07-04"),
    );
    const result = buildLabSeries(b, "procedure_result", AT);
    expect(result.documented).toBe(true);
    if (!result.documented) throw new Error("unreachable");

    expect(result.series).toHaveLength(2);
    const a1c = result.series.find((s) => s.code === "4548-4");
    expect(a1c?.test).toBe("Hemoglobin A1c");
    expect(a1c?.unit).toBe("%");
    // sorted ascending by date, regardless of input order
    expect(a1c?.points.map((p) => p.value)).toEqual([8.1, 7.4, 6.9]);
    expect(a1c?.points.map((p) => p.date.slice(0, 10))).toEqual(["2026-01-10", "2026-04-15", "2026-07-04"]);
    // each point traces to its own Observation uuid (→ its source PDF)
    expect(a1c?.points.map((p) => p.obsUuid)).toEqual(["a1", "a2", "a3"]);

    const egfr = result.series.find((s) => s.code === "48642-3");
    expect(egfr?.points).toHaveLength(2);
  });

  it("groups the multi-PDF case: two separate lab PDFs (different dates) become one 2-point line", () => {
    // Each PDF committed one A1c; the series is the union across documents.
    const pdf1 = obs("obs-from-pdf-1", "4548-4", "Hemoglobin A1c", 8.1, "%", "2026-01-10");
    const pdf2 = obs("obs-from-pdf-2", "4548-4", "Hemoglobin A1c", 6.9, "%", "2026-07-04");
    const result = buildLabSeries(bundle(pdf1, pdf2), "procedure_result", AT);
    if (!result.documented) throw new Error("unreachable");
    expect(result.series).toHaveLength(1);
    expect(result.series[0]!.points).toHaveLength(2);
    expect(result.series[0]!.points.map((p) => p.obsUuid)).toEqual(["obs-from-pdf-1", "obs-from-pdf-2"]);
  });

  it("AC1b: a single reading → a one-point series (the widget shows 'no trend yet')", () => {
    const result = buildLabSeries(bundle(obs("a1", "4548-4", "A1c", 8.1, "%", "2026-01-10")), "procedure_result", AT);
    if (!result.documented) throw new Error("unreachable");
    expect(result.series).toHaveLength(1);
    expect(result.series[0]!.points).toHaveLength(1);
  });

  it("AC3: no lab Observations → documented:false (never 'normal')", () => {
    expect(buildLabSeries(bundle(), "procedure_result", AT).documented).toBe(false);
  });

  it("cleans the derived-annotation from the display name and merges the same test across coding styles", () => {
    // The write path names a derived Observation "Ferritin [co-pilot-derived …] (ref 15-150)" and may
    // code it by LOINC in one document but by name in an older one — a code key would split them.
    const b = bundle(
      {
        resource: {
          resourceType: "Observation",
          id: "x1",
          code: { text: "Ferritin [co-pilot-derived from document #49, citation d#f] (ref 15-150)", coding: [{ code: "2276-4" }] },
          effectiveDateTime: "2026-01-10",
          valueQuantity: { value: 11, unit: "ng/mL" },
        },
      },
      {
        resource: {
          resourceType: "Observation",
          id: "x2",
          code: { text: "Ferritin" },
          effectiveDateTime: "2026-07-04",
          valueQuantity: { value: 45, unit: "ng/mL" },
        },
      },
    );
    const result = buildLabSeries(b, "procedure_result", AT);
    if (!result.documented) throw new Error("unreachable");
    expect(result.series).toHaveLength(1);
    expect(result.series[0]!.test).toBe("Ferritin"); // annotation stripped
    expect(result.series[0]!.points.map((p) => p.value)).toEqual([11, 45]); // merged + sorted
    expect(result.series[0]!.code).toBe("2276-4"); // LOINC preferred for metadata
  });

  it("groups by name when no LOINC code is present", () => {
    const noCode = (id: string, value: number, date: string) => ({
      resource: { resourceType: "Observation", id, code: { text: "Ferritin" }, effectiveDateTime: date, valueQuantity: { value, unit: "ng/mL" } },
    });
    const result = buildLabSeries(bundle(noCode("f1", 11, "2026-01-10"), noCode("f2", 22, "2026-07-04")), "procedure_result", AT);
    if (!result.documented) throw new Error("unreachable");
    expect(result.series).toHaveLength(1);
    expect(result.series[0]!.test).toBe("Ferritin");
    expect(result.series[0]!.points.map((p) => p.value)).toEqual([11, 22]);
  });

  it("returns series sorted by test name for deterministic output", () => {
    const result = buildLabSeries(
      bundle(
        obs("z1", "zzz", "Zinc", 80, "ug/dL", "2026-01-10"),
        obs("a1", "aaa", "Albumin", 4.1, "g/dL", "2026-01-10"),
      ),
      "procedure_result",
      AT,
    );
    if (!result.documented) throw new Error("unreachable");
    expect(result.series.map((s) => s.test)).toEqual(["Albumin", "Zinc"]);
  });
});
