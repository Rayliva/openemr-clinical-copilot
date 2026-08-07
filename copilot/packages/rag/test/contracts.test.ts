import { describe, it, expect } from "vitest";
import { GuidelineChunk, EvidenceSnippet } from "../src/contracts.js";

describe("RAG contracts", () => {
  it("GuidelineChunk parses a well-formed chunk and rejects missing provenance", () => {
    const ok = { chunkId: "d::0::0", doc: "t2dm", section: "Glycemic Targets", text: "A1c < 7%." };
    expect(GuidelineChunk.parse(ok).chunkId).toBe("d::0::0");
    expect(GuidelineChunk.safeParse({ ...ok, chunkId: "" }).success).toBe(false);
    expect(GuidelineChunk.safeParse({ doc: "t2dm", section: "s", text: "t" }).success).toBe(false);
  });

  it("EvidenceSnippet requires a numeric score", () => {
    const base = { chunkId: "c", doc: "d", section: "s", text: "t" };
    expect(EvidenceSnippet.safeParse({ ...base, score: 0.42 }).success).toBe(true);
    expect(EvidenceSnippet.safeParse({ ...base }).success).toBe(false);
    expect(EvidenceSnippet.safeParse({ ...base, score: "high" }).success).toBe(false);
  });
});
