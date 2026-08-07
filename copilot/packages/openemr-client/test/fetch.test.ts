import { describe, it, expect } from "vitest";
import { createNodeFetch } from "../src/http/fetch.js";

describe("createNodeFetch", () => {
  it("returns the global fetch when insecureTls is not set", () => {
    expect(createNodeFetch()).toBe(fetch);
    expect(createNodeFetch({ insecureTls: false })).toBe(fetch);
  });

  it("returns a distinct fetch function when insecureTls is set", () => {
    const f = createNodeFetch({ insecureTls: true });
    expect(typeof f).toBe("function");
    expect(f).not.toBe(fetch);
  });
});
