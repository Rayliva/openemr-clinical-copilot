import { describe, it, expect } from "vitest";
import { chunkMarkdown } from "../src/chunk.js";

describe("chunkMarkdown", () => {
  it("produces at least one chunk per section, tagged with the section heading + doc", () => {
    const md = [
      "# Type 2 Diabetes",
      "",
      "## Glycemic Targets",
      "A1c goal is below 7% for most non-pregnant adults.",
      "",
      "## Intensification",
      "Intensify therapy when A1c remains above the individualized target.",
    ].join("\n");
    const chunks = chunkMarkdown({ id: "t2dm", markdown: md });
    const sections = new Set(chunks.map((c) => c.section));
    expect(sections.has("Glycemic Targets")).toBe(true);
    expect(sections.has("Intensification")).toBe(true);
    for (const c of chunks) {
      expect(c.doc).toBe("t2dm");
      expect(c.text.trim().length).toBeGreaterThan(0);
    }
  });

  it("splits a long section into overlapping windows that stay near the target size", () => {
    const long = "clinical sentence about therapy. ".repeat(120); // ~4000 chars
    const md = `## Big Section\n${long}`;
    const chunks = chunkMarkdown({ id: "big", markdown: md }, { targetChars: 800, overlapChars: 120 });
    const big = chunks.filter((c) => c.section === "Big Section");
    expect(big.length).toBeGreaterThan(1);
    for (const c of big) {
      expect(c.text.length).toBeLessThanOrEqual(1000); // target + slack, never the whole section
    }
  });

  it("gives stable, unique chunkIds across runs (idempotent re-chunking)", () => {
    const md = "## A\nalpha guideline text.\n\n## B\nbeta guideline text.";
    const a = chunkMarkdown({ id: "d", markdown: md });
    const b = chunkMarkdown({ id: "d", markdown: md });
    expect(a.map((c) => c.chunkId)).toEqual(b.map((c) => c.chunkId));
    expect(new Set(a.map((c) => c.chunkId)).size).toBe(a.length);
  });

  it("loses no section (every heading appears in the output)", () => {
    const md = "## One\nx\n\n## Two\ny\n\n## Three\nz";
    const sections = new Set(chunkMarkdown({ id: "d", markdown: md }).map((c) => c.section));
    expect([...sections].sort()).toEqual(["One", "Three", "Two"]);
  });
});
