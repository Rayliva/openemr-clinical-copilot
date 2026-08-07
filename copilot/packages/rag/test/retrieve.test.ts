import { describe, it, expect } from "vitest";
import {
  cosineSimilarity,
  bagOfWordsEmbed,
  buildIndex,
  retrieveEvidence,
} from "../src/retrieve.js";
import { chunkMarkdown } from "../src/chunk.js";
import { readFileSync } from "node:fs";

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors, 0 for orthogonal, 0 for a zero vector", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0); // no NaN on a zero vector
  });
});

describe("retrieveEvidence over the committed diabetes corpus (offline, bag-of-words embedder)", () => {
  const markdown = readFileSync(
    new URL("../corpus/type2-diabetes-management.md", import.meta.url),
    "utf8",
  );
  const chunks = chunkMarkdown({ id: "t2dm-management", markdown });

  it("retrieves the metformin/renal-dosing chunk for a metformin query", async () => {
    const index = await buildIndex(chunks, bagOfWordsEmbed);
    const results = await retrieveEvidence("metformin dosing with reduced eGFR renal function", index, bagOfWordsEmbed, {
      topK: 3,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(3);
    // the top result should be the first-line-therapy section (the one that discusses metformin + eGFR)
    expect(results[0]?.section).toBe("First-Line Pharmacologic Therapy");
    // every returned snippet carries provenance + a score
    for (const r of results) {
      expect(r.doc).toBe("t2dm-management");
      expect(typeof r.score).toBe("number");
      expect(r.text.length).toBeGreaterThan(0);
    }
  });

  it("retrieves the statin chunk for a statin/cholesterol query", async () => {
    const index = await buildIndex(chunks, bagOfWordsEmbed);
    const results = await retrieveEvidence("should this patient be on a statin for cholesterol", index, bagOfWordsEmbed, {
      topK: 2,
    });
    expect(results.map((r) => r.section)).toContain("Statin Therapy in Diabetes");
  });

  it("returns deterministic results (same query → same ranking)", async () => {
    const index = await buildIndex(chunks, bagOfWordsEmbed);
    const a = await retrieveEvidence("A1c target and intensification", index, bagOfWordsEmbed, { topK: 3 });
    const b = await retrieveEvidence("A1c target and intensification", index, bagOfWordsEmbed, { topK: 3 });
    expect(a.map((r) => r.chunkId)).toEqual(b.map((r) => r.chunkId));
  });

  it("an empty index yields no evidence (no throw, no fabricated citation)", async () => {
    const results = await retrieveEvidence("anything", [], bagOfWordsEmbed, { topK: 3 });
    expect(results).toEqual([]);
  });
});

describe("query expansion improves keyword recall for clinical abbreviations", () => {
  // A chunk that uses the full term "hypertension" (never the abbreviation "htn"), plus an unrelated
  // distractor. Bag-of-words hashes "htn" and "hypertension" to different dims, so WITHOUT expansion
  // an "htn" query matches this chunk on neither the keyword arm (no "htn" token) nor the dense arm
  // (different hashes) — expansion is the only path that surfaces it.
  const htnChunk = {
    chunkId: "guides::bp::0",
    doc: "guides",
    section: "Blood Pressure",
    text: "Hypertension in these patients: target blood pressure below 130 over 80 where tolerated.",
  };
  const distractor = {
    chunkId: "guides::vaccines::0",
    doc: "guides",
    section: "Immunization",
    text: "Offer the annual influenza vaccine and keep the pneumococcal series up to date.",
  };

  it("retrieves the hypertension chunk for an 'htn' abbreviation query", async () => {
    const index = await buildIndex([htnChunk, distractor], bagOfWordsEmbed);
    const results = await retrieveEvidence("htn goal for this patient", index, bagOfWordsEmbed, { topK: 1 });
    expect(results[0]?.chunkId).toBe("guides::bp::0");
  });
});
