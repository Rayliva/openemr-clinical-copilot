import { describe, it, expect } from "vitest";
import {
  RouteDecision,
  decideRoute,
  type RouteContext,
} from "../src/graph/supervisor.js";

const base: RouteContext = { hops: 0, maxHops: 2, alreadyRouted: [] };

describe("RouteDecision contract", () => {
  it("parses a well-formed decision", () => {
    const d = RouteDecision.parse({ next: "intake_extractor", rationale: "a document needs extracting" });
    expect(d.next).toBe("intake_extractor");
  });

  it("rejects an unknown route target", () => {
    expect(RouteDecision.safeParse({ next: "delete_chart", rationale: "x" }).success).toBe(false);
  });

  it("rejects a missing/empty rationale", () => {
    expect(RouteDecision.safeParse({ next: "ready" }).success).toBe(false);
    expect(RouteDecision.safeParse({ next: "ready", rationale: "" }).success).toBe(false);
  });
});

describe("decideRoute — bounded, degrade-not-hang, never throws", () => {
  it("passes through a valid worker decision", () => {
    const out = decideRoute({ next: "evidence_retriever", rationale: "guideline question" }, base);
    expect(out.next).toBe("evidence_retriever");
    expect(out.rationale).toBe("guideline question");
  });

  it("passes through a valid ready decision (chart-only fast path)", () => {
    const out = decideRoute({ next: "ready", rationale: "chart answers it" }, base);
    expect(out.next).toBe("ready");
  });

  it("degrades to ready on an invalid route target (never routes on garbage)", () => {
    const out = decideRoute({ next: "delete_chart", rationale: "malice" }, base);
    expect(out.next).toBe("ready");
    expect(out.rationale.length).toBeGreaterThan(0);
  });

  it("degrades to ready on a missing rationale", () => {
    expect(decideRoute({ next: "intake_extractor" }, base).next).toBe("ready");
  });

  it("degrades to ready on non-object / null / non-JSON raw output — no throw", () => {
    expect(decideRoute(null, base).next).toBe("ready");
    expect(decideRoute("not json", base).next).toBe("ready");
    expect(decideRoute(42, base).next).toBe("ready");
    expect(decideRoute(undefined, base).next).toBe("ready");
  });

  it("forces ready when the hop cap is reached, even if the model wants a worker", () => {
    const out = decideRoute(
      { next: "intake_extractor", rationale: "wants more" },
      { hops: 2, maxHops: 2, alreadyRouted: [] },
    );
    expect(out.next).toBe("ready");
  });

  it("forces ready when the chosen worker already ran (no double-run / oscillation)", () => {
    const out = decideRoute(
      { next: "evidence_retriever", rationale: "again" },
      { hops: 1, maxHops: 2, alreadyRouted: ["evidence_retriever"] },
    );
    expect(out.next).toBe("ready");
  });

  it("always yields a non-empty rationale (the log always has a reason)", () => {
    for (const raw of [null, { next: "nope" }, { next: "ready", rationale: "ok" }]) {
      expect(decideRoute(raw, base).rationale.length).toBeGreaterThan(0);
    }
  });
});
