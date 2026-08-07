import { describe, it, expect } from "vitest";
import { ReferralFaxExtraction } from "../src/schemas/referralFax.js";
import { locateReferralFaxValues } from "../src/referralFaxBoxMatch.js";
import type { OcrWord, OcrPage } from "../src/boxMatch.js";

/** A citation for a referral-fax value (sourceType is the fourth allowed document kind). */
const cite = (q: string) => ({
  sourceType: "referral_fax" as const,
  sourceId: "ref-1",
  pageOrSection: "Referral",
  fieldOrChunkId: "referral",
  quoteOrValue: q,
});

const field = (value: string, conf = 0.95) => ({ value, citation: cite(value), confidence: conf });

/** One OCR word with a small box on page 1. */
const w = (text: string, x: number): OcrWord => ({ text, box: { page: 1, x, y: 0.5, w: 0.06, h: 0.02 } });

/** An OCR page carrying the words of the referral fields. */
const ocr: OcrPage = {
  words: [
    w("Cardiology", 0.1), w("Dr", 0.2), w("Chen", 0.26), w("chest", 0.4), w("pain", 0.5),
  ],
};

const extraction = ReferralFaxExtraction.parse({
  docType: "referral_fax",
  referralDate: field("2026-03-11"),
  referringProvider: field("Dr Chen"),
  referredTo: field("Cardiology"),
  reason: field("chest pain"),
  citation: cite("Referral Fax"),
});

describe("ReferralFaxExtraction schema", () => {
  it("parses a valid referral_fax extraction with a subset of fields present", () => {
    expect(extraction.docType).toBe("referral_fax");
    expect(extraction.referredTo?.value).toBe("Cardiology");
    expect(extraction.diagnosis).toBeUndefined(); // absent field stays absent
  });

  it("rejects a wrong docType (schema is canonical, not coerced)", () => {
    expect(ReferralFaxExtraction.safeParse({ ...extraction, docType: "lab_pdf" }).success).toBe(false);
  });

  it("rejects a present field missing its citation (every field is cited)", () => {
    const bad = { ...extraction, reason: { value: "chest pain", confidence: 0.9 } };
    expect(ReferralFaxExtraction.safeParse(bad).success).toBe(false);
  });
});

describe("locateReferralFaxValues — flatten + box-match", () => {
  it("labels each present field distinctly, in a stable order, omitting absent fields", () => {
    const { results } = locateReferralFaxValues(extraction, ocr);
    expect(results.map((r) => r.result.testName)).toEqual([
      "Referral date",
      "Referring provider",
      "Referred to",
      "Reason for referral",
    ]);
  });

  it("box-matches a value whose words are on the page (tight box set)", () => {
    const { results } = locateReferralFaxValues(extraction, ocr);
    const referredTo = results.find((r) => r.result.testName === "Referred to");
    expect(referredTo?.match.state).not.toBe("unverified");
    expect(referredTo?.result.citation.locator).toBeDefined();
  });

  it("forces review (never drops) a field absent from the page", () => {
    const { results } = locateReferralFaxValues(extraction, { words: [] });
    expect(results).toHaveLength(4);
    for (const r of results) {
      expect(r.match.state).toBe("unverified");
      expect(r.result.citation.locator).toBeUndefined();
      expect(r.result.citation.pageOrSection.length).toBeGreaterThan(0);
    }
  });

  it("emits no rows for an all-absent extraction (absence != empty)", () => {
    const empty = ReferralFaxExtraction.parse({ docType: "referral_fax", citation: cite("Referral Fax") });
    expect(locateReferralFaxValues(empty, ocr).results).toHaveLength(0);
  });
});
