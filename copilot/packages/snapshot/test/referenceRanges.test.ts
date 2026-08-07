import { describe, it, expect } from "vitest";
import { referenceRangeFor, attachReferenceRanges } from "../src/referenceRanges.js";
import type { LabSeriesResult } from "../src/observations.js";

describe("referenceRangeFor — age/sex-aware, sourced", () => {
  it("ferritin: premenopausal women (age<51) 13–150, with a source link + supporting quote", () => {
    const r = referenceRangeFor({ name: "Ferritin" }, { sex: "female", ageYears: 34 });
    expect(r).toMatchObject({ low: 13, high: 150, unit: "ng/mL", population: "premenopausal women" });
    expect(r?.source).toMatch(/MedlinePlus/i);
    expect(r?.sourceUrl).toMatch(/^https:\/\/medlineplus\.gov\//);
    expect(r?.sourceQuote).toContain("13 to 150");
  });

  it("ferritin: postmenopausal women (age>=51) approach the male range 30–400", () => {
    expect(referenceRangeFor({ name: "Ferritin" }, { sex: "female", ageYears: 58 })).toMatchObject({
      low: 30,
      high: 400,
      population: "postmenopausal women",
    });
  });

  it("ferritin: men 30–400", () => {
    expect(referenceRangeFor({ name: "Ferritin" }, { sex: "male", ageYears: 40 })).toMatchObject({ low: 30, high: 400, population: "men" });
  });

  it("returns null for a sex-dependent analyte when sex is unknown (never guess)", () => {
    expect(referenceRangeFor({ name: "Ferritin" }, {})).toBeNull();
    expect(referenceRangeFor({ name: "Hemoglobin" }, { ageYears: 40 })).toBeNull();
  });

  it("hemoglobin / creatinine / HDL differ by sex", () => {
    expect(referenceRangeFor({ name: "Hemoglobin" }, { sex: "female" })).toMatchObject({ low: 12.1, high: 15.1, unit: "g/dL" });
    expect(referenceRangeFor({ name: "Hemoglobin" }, { sex: "male" })).toMatchObject({ low: 13.8, high: 17.2 });
    expect(referenceRangeFor({ name: "Creatinine" }, { sex: "female" })).toMatchObject({ low: 0.5, high: 0.95, unit: "mg/dL" });
    expect(referenceRangeFor({ name: "HDL" }, { sex: "male" })).toMatchObject({ low: 40 });
    expect(referenceRangeFor({ name: "HDL Cholesterol" }, { sex: "female" })).toMatchObject({ low: 50 });
  });

  it("MCV is sex-neutral 79–95 fL", () => {
    expect(referenceRangeFor({ name: "MCV" }, {})).toMatchObject({ low: 79, high: 95, unit: "fL" });
  });

  it("disambiguates hemoglobin A1c from hemoglobin, and LDL/total cholesterol", () => {
    expect(referenceRangeFor({ name: "Hemoglobin A1c" }, { sex: "female" })).toMatchObject({ high: 5.6, unit: "%" });
    expect(referenceRangeFor({ name: "LDL Cholesterol" }, {})).toMatchObject({ high: 100 });
    expect(referenceRangeFor({ name: "Total Cholesterol" }, {})).toMatchObject({ high: 200 });
  });

  it("matches by LOINC code when the name is unhelpful", () => {
    expect(referenceRangeFor({ code: "2276-4" }, { sex: "female", ageYears: 30 })).toMatchObject({ low: 13, high: 150 });
    expect(referenceRangeFor({ code: "718-7" }, { sex: "male" })).toMatchObject({ low: 13.8 });
  });

  it("returns null for an unknown analyte", () => {
    expect(referenceRangeFor({ name: "Zorbium level" }, { sex: "female", ageYears: 30 })).toBeNull();
  });
});

describe("attachReferenceRanges", () => {
  it("attaches a range to each resolvable series, leaving others without one", () => {
    const result: LabSeriesResult = {
      documented: true,
      series: [
        { test: "Ferritin", code: "2276-4", unit: "ng/mL", points: [] },
        { test: "Zorbium", code: "9999-9", unit: "x", points: [] },
      ],
    };
    const out = attachReferenceRanges(result, { sex: "female", ageYears: 34 });
    if (!out.documented) throw new Error("unreachable");
    expect(out.series[0]?.referenceRange).toMatchObject({ low: 13, high: 150 });
    expect(out.series[1]?.referenceRange).toBeUndefined();
  });

  it("is a no-op on a documented:false result", () => {
    expect(attachReferenceRanges({ documented: false }, { sex: "female" })).toEqual({ documented: false });
  });
});
