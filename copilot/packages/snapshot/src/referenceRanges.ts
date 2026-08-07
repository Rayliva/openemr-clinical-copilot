import type { LabSeriesResult } from "./observations.js";

/**
 * A general (non-PHI) reference range for a lab analyte, resolved for a patient's age + sex. Cited to
 * its source with a link + the exact supporting quote (so the chart can link the source and highlight
 * the referenced text). This is *general medical knowledge* shown as context on the trend chart —
 * never a patient finding and never a constraint-engine fact (`verification-gate`). Grounded in
 * `docs/specs/w2-lab-reference-ranges.md`.
 */
export interface ReferenceRange {
  readonly low: number;
  readonly high: number;
  readonly unit: string;
  /** Who this range is for, e.g. "premenopausal women", "men", "adults (optimal < 100)". */
  readonly population: string;
  /** The citable source of the range (name). */
  readonly source: string;
  /** A link to the authoritative source page for this analyte. */
  readonly sourceUrl: string;
  /** The exact supporting text from the source (the "referenced area" to highlight). */
  readonly sourceQuote: string;
  /** Optional extra context (e.g. a management target that differs from the normal range). */
  readonly note?: string;
}

export interface PatientContext {
  readonly ageYears?: number;
  /** FHIR `gender` or similar; normalized internally to male/female. */
  readonly sex?: string;
}

const MEDLINEPLUS = "MedlinePlus (NIH)";
const ADA = "American Diabetes Association";
const ACC = "ACC/AHA cholesterol guideline";
const KDIGO = "KDIGO / CKD-EPI";

/** Normalize a FHIR gender / free-text sex to `"male" | "female" | null`. */
function normalizeSex(sex: string | undefined): "male" | "female" | null {
  if (sex === undefined) {
    return null;
  }
  const s = sex.trim().toLowerCase();
  if (s === "male" || s === "m") {
    return "male";
  }
  if (s === "female" || s === "f") {
    return "female";
  }
  return null;
}

/** The reference-range fields a rule produces before the analyte-level `sourceUrl` is merged in. */
type RangeCore = Omit<ReferenceRange, "sourceUrl">;

/**
 * One analyte's rule: how to recognize it (LOINC codes + a name predicate), the authoritative
 * source URL, and how to produce a range for a patient context (returns null when the context is
 * insufficient — e.g. a sex-dependent analyte with unknown sex — never guess). Order in the list
 * matters: more specific analytes (A1c, LDL/HDL) precede the ones whose names they contain
 * (hemoglobin, cholesterol).
 */
interface AnalyteRule {
  readonly codes: readonly string[];
  readonly url: string;
  readonly matches: (name: string) => boolean;
  readonly range: (ctx: PatientContext) => RangeCore | null;
}

const POSTMENOPAUSE_AGE = 51;

const RULES: readonly AnalyteRule[] = [
  // Hemoglobin A1c — BEFORE hemoglobin (its name contains "hemoglobin").
  {
    codes: ["4548-4", "17856-6"],
    url: "https://medlineplus.gov/a1c.html",
    matches: (n) => n.includes("a1c") || n.includes("hba1c") || n.includes("glycated") || n.includes("glycohemoglobin"),
    range: () => ({ low: 4.0, high: 5.6, unit: "%", population: "nondiabetic adults", source: `${MEDLINEPLUS} / ${ADA}`, sourceQuote: "A normal A1c level is below 5.7%.", note: "Diabetes management target is typically < 7% (ADA)." }),
  },
  // LDL / HDL cholesterol — BEFORE total cholesterol (names contain "cholesterol").
  {
    codes: ["2089-1", "13457-7", "18262-6"],
    url: "https://medlineplus.gov/ldlthebadcholesterol.html",
    matches: (n) => n.includes("ldl"),
    range: () => ({ low: 0, high: 100, unit: "mg/dL", population: "adults (optimal < 100)", source: ACC, sourceQuote: "An optimal LDL cholesterol level is less than 100 mg/dL." }),
  },
  {
    codes: ["2085-9"],
    url: "https://medlineplus.gov/hdlthegoodcholesterol.html",
    matches: (n) => n.includes("hdl"),
    range: (ctx) => {
      const sex = normalizeSex(ctx.sex);
      if (sex === null) {
        return null;
      }
      return sex === "female"
        ? { low: 50, high: 100, unit: "mg/dL", population: "women (desirable ≥ 50)", source: ACC, sourceQuote: "For women, an HDL of 50 mg/dL or higher is desirable (higher is protective)." }
        : { low: 40, high: 100, unit: "mg/dL", population: "men (desirable ≥ 40)", source: ACC, sourceQuote: "For men, an HDL of 40 mg/dL or higher is desirable (higher is protective)." };
    },
  },
  {
    codes: ["2093-3"],
    url: "https://medlineplus.gov/cholesterol.html",
    matches: (n) => n.includes("cholesterol"),
    range: () => ({ low: 0, high: 200, unit: "mg/dL", population: "adults (desirable < 200)", source: ACC, sourceQuote: "A desirable total cholesterol level is less than 200 mg/dL." }),
  },
  {
    codes: ["2571-8"],
    url: "https://medlineplus.gov/triglycerides.html",
    matches: (n) => n.includes("triglyceride"),
    range: () => ({ low: 0, high: 150, unit: "mg/dL", population: "adults (normal < 150)", source: ACC, sourceQuote: "A normal triglyceride level is less than 150 mg/dL." }),
  },
  // Ferritin — age + sex (pre- vs post-menopause).
  {
    codes: ["2276-4"],
    url: "https://medlineplus.gov/ency/article/003490.htm",
    matches: (n) => n.includes("ferritin"),
    range: (ctx) => {
      const sex = normalizeSex(ctx.sex);
      if (sex === null) {
        return null;
      }
      if (sex === "male") {
        return { low: 30, high: 400, unit: "ng/mL", population: "men", source: MEDLINEPLUS, sourceQuote: "Male: 30 to 400 ng/mL." };
      }
      const postmenopausal = ctx.ageYears !== undefined && ctx.ageYears >= POSTMENOPAUSE_AGE;
      return postmenopausal
        ? { low: 30, high: 400, unit: "ng/mL", population: "postmenopausal women", source: MEDLINEPLUS, sourceQuote: "After menopause, women's ferritin approaches the male range (30 to 400 ng/mL).", note: "After menopause, women's ferritin approaches the male range." }
        : { low: 13, high: 150, unit: "ng/mL", population: "premenopausal women", source: MEDLINEPLUS, sourceQuote: "Female: 13 to 150 ng/mL." };
    },
  },
  // Hemoglobin — sex-dependent (checked AFTER A1c).
  {
    codes: ["718-7"],
    url: "https://medlineplus.gov/ency/article/003645.htm",
    matches: (n) => n.includes("hemoglobin") || n === "hgb" || n === "hb",
    range: (ctx) => {
      const sex = normalizeSex(ctx.sex);
      if (sex === null) {
        return null;
      }
      return sex === "female"
        ? { low: 12.1, high: 15.1, unit: "g/dL", population: "women", source: MEDLINEPLUS, sourceQuote: "Female: 12.1 to 15.1 g/dL." }
        : { low: 13.8, high: 17.2, unit: "g/dL", population: "men", source: MEDLINEPLUS, sourceQuote: "Male: 13.8 to 17.2 g/dL." };
    },
  },
  {
    codes: ["787-2"],
    url: "https://medlineplus.gov/ency/article/003648.htm",
    matches: (n) => n.includes("mcv") || n.includes("mean corpuscular volume"),
    range: () => ({ low: 79, high: 95, unit: "fL", population: "adults", source: MEDLINEPLUS, sourceQuote: "The normal range for MCV is 79 to 95 fL." }),
  },
  // eGFR — before creatinine (some panels label eGFR "creatinine, estimated GFR").
  {
    codes: ["33914-3", "48642-3", "48643-1", "62238-1"],
    url: "https://medlineplus.gov/ency/article/007305.htm",
    matches: (n) => n.includes("egfr") || n.includes("gfr"),
    range: () => ({ low: 60, high: 120, unit: "mL/min/1.73m²", population: "adults (≥ 60 is normal)", source: KDIGO, sourceQuote: "An eGFR of 60 or higher is in the normal range." }),
  },
  {
    codes: ["2160-0"],
    url: "https://medlineplus.gov/ency/article/003475.htm",
    matches: (n) => n.includes("creatinine"),
    range: (ctx) => {
      const sex = normalizeSex(ctx.sex);
      if (sex === null) {
        return null;
      }
      return sex === "female"
        ? { low: 0.5, high: 0.95, unit: "mg/dL", population: "women", source: MEDLINEPLUS, sourceQuote: "Female: 0.5 to 0.95 mg/dL." }
        : { low: 0.7, high: 1.3, unit: "mg/dL", population: "men", source: MEDLINEPLUS, sourceQuote: "Male: 0.7 to 1.3 mg/dL." };
    },
  },
  {
    codes: ["1558-6", "2345-7"],
    url: "https://medlineplus.gov/lab-tests/blood-glucose-test/",
    matches: (n) => n.includes("glucose"),
    range: () => ({ low: 70, high: 99, unit: "mg/dL", population: "fasting adults", source: `${MEDLINEPLUS} / ${ADA}`, sourceQuote: "A normal fasting blood glucose level is 70 to 99 mg/dL." }),
  },
  {
    codes: ["3016-3", "11580-8"],
    url: "https://medlineplus.gov/lab-tests/tsh-thyroid-stimulating-hormone-test/",
    matches: (n) => n.includes("tsh") || n.includes("thyroid stimulating"),
    range: () => ({ low: 0.4, high: 4.0, unit: "mIU/L", population: "adults", source: MEDLINEPLUS, sourceQuote: "A normal TSH level is about 0.4 to 4.0 mIU/L." }),
  },
  {
    codes: ["2823-3", "6298-4"],
    url: "https://medlineplus.gov/ency/article/003484.htm",
    matches: (n) => n.includes("potassium"),
    range: () => ({ low: 3.5, high: 5.0, unit: "mmol/L", population: "adults", source: MEDLINEPLUS, sourceQuote: "The normal range for potassium is 3.5 to 5.0 mmol/L." }),
  },
];

/**
 * Resolve the reference range for a lab test given the patient's age + sex, or `null` when the
 * analyte is unknown or the context is insufficient (a sex-dependent analyte with unknown sex).
 * Matched by LOINC code first (exact), else by normalized name via the ordered rule list. The
 * analyte-level `sourceUrl` is merged into the result.
 */
export function referenceRangeFor(
  test: { readonly code?: string; readonly name?: string },
  ctx: PatientContext,
): ReferenceRange | null {
  const code = test.code?.trim();
  const name = (test.name ?? "").toLowerCase();
  for (const rule of RULES) {
    const hit = (code !== undefined && code !== "" && rule.codes.includes(code)) || (name !== "" && rule.matches(name));
    if (hit) {
      const core = rule.range(ctx);
      return core === null ? null : { ...core, sourceUrl: rule.url };
    }
  }
  return null;
}

/**
 * Enrich a lab-series result with each series' reference range for this patient. Pure; absence-safe
 * (a `documented:false` result passes through unchanged). A series whose analyte or context does not
 * resolve simply carries no `referenceRange`.
 */
export function attachReferenceRanges(result: LabSeriesResult, ctx: PatientContext): LabSeriesResult {
  if (!result.documented) {
    return result;
  }
  return {
    documented: true,
    series: result.series.map((s) => {
      const range = referenceRangeFor({ ...(s.code !== undefined ? { code: s.code } : {}), name: s.test }, ctx);
      return range === null ? s : { ...s, referenceRange: range };
    }),
  };
}
