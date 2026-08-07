import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { chunkMarkdown } from "../src/chunk.js";

describe("committed guideline corpus", () => {
  it("type2-diabetes-management.md chunks with every section preserved", () => {
    const markdown = readFileSync(
      new URL("../corpus/type2-diabetes-management.md", import.meta.url),
      "utf8",
    );
    const chunks = chunkMarkdown({ id: "t2dm-management", markdown });
    const sections = new Set(chunks.map((c) => c.section));
    for (const expected of [
      "Glycemic Targets",
      "Treatment Intensification",
      "First-Line Pharmacologic Therapy",
      "Statin Therapy in Diabetes",
      "Blood Pressure Targets in Diabetes",
    ]) {
      expect(sections.has(expected), `missing section: ${expected}`).toBe(true);
    }
    // every chunk carries provenance + non-empty text (nothing to feed the model uncited)
    for (const c of chunks) {
      expect(c.doc).toBe("t2dm-management");
      expect(c.text.trim().length).toBeGreaterThan(0);
      expect(c.chunkId).toMatch(/^t2dm-management::/);
    }
    // the H1 title + its corpus-provenance disclaimer must NOT be a retrievable chunk (it would
    // otherwise surface as "guideline evidence").
    expect(chunks.some((c) => c.text.includes("not a substitute"))).toBe(false);
    expect([...new Set(chunks.map((c) => c.section))]).not.toContain(
      "Type 2 Diabetes Management — Primary Care Reference",
    );
  });
});
