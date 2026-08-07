import { describe, it, expect } from "vitest";
import { fuseRRF, type RankedItem } from "../src/fuse.js";

describe("fuseRRF — reciprocal rank fusion of dense + keyword lists", () => {
  it("ranks an item high in BOTH lists above one high in only one", () => {
    const dense: RankedItem[] = [{ chunkId: "x" }, { chunkId: "y" }];
    const keyword: RankedItem[] = [{ chunkId: "x" }, { chunkId: "z" }];
    const fused = fuseRRF([dense, keyword]);
    expect(fused[0]?.chunkId).toBe("x"); // present in both → highest fused score
    const ids = fused.map((f) => f.chunkId);
    expect(ids).toContain("y");
    expect(ids).toContain("z");
  });

  it("keeps an item that appears in only one list", () => {
    const fused = fuseRRF([[{ chunkId: "only" }], []]);
    expect(fused.map((f) => f.chunkId)).toEqual(["only"]);
    expect(fused[0]?.score).toBeGreaterThan(0);
  });

  it("is deterministic (same input → same output)", () => {
    const l1: RankedItem[] = [{ chunkId: "a" }, { chunkId: "b" }];
    const l2: RankedItem[] = [{ chunkId: "b" }, { chunkId: "c" }];
    expect(fuseRRF([l1, l2])).toEqual(fuseRRF([l1, l2]));
  });

  it("empty input → empty result, no throw", () => {
    expect(fuseRRF([])).toEqual([]);
    expect(fuseRRF([[], []])).toEqual([]);
  });

  it("honors the k constant (returns positive fused scores)", () => {
    const fused = fuseRRF([[{ chunkId: "a" }, { chunkId: "b" }]], { k: 1 });
    expect(fused[0]?.score).toBeGreaterThan(0);
    // rank-1 item scores higher than rank-2 within a single list
    expect((fused[0]?.score ?? 0)).toBeGreaterThan(fused[1]?.score ?? 0);
  });
});
