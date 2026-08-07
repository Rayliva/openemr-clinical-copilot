import { describe, it, expect } from "vitest";
import type { PatientDemographics } from "@copilot/snapshot";
import { buildAgentGraph } from "../src/graph/graph.js";
import { withTracer, type TraceSpan, type Tracer } from "../src/observability/tracing.js";
import type { DemographicsToolFn, GenerateFn } from "../src/graph/types.js";
import type { RouteTarget, SupervisorRouter } from "../src/graph/supervisor.js";

const SUSAN: PatientDemographics = {
  id: "pid-1",
  name: "Susan Underwood",
  birthDate: "1967-02-08",
  gender: "female",
  provenance: { sourceTable: "patient_data", rowUuid: "pid-1", fetchedAt: "2026-07-08T12:00:00.000Z" },
};
const foundTool: DemographicsToolFn = async () => ({ found: true, demographics: SUSAN });
const okGenerate: GenerateFn = async () => ({
  claims: [{ statement: "Patient is Susan Underwood, DOB 1967-02-08.", sourceRefs: ["pid-1"] }],
});

function scriptRouter(seq: readonly RouteTarget[]): SupervisorRouter {
  let i = 0;
  return async () => {
    const next = seq[i] ?? "ready";
    i += 1;
    return { next, rationale: `hop ${i}` };
  };
}

/** A tracer that records the span tree so a test can assert parent→child nesting. */
interface RecordedSpan {
  readonly name: string;
  readonly children: RecordedSpan[];
}
function recordingTracer(): { tracer: Tracer; roots: RecordedSpan[] } {
  const roots: RecordedSpan[] = [];
  // A span appends its own record to `into`, and its children append to its own `children`.
  function makeSpan(name: string, into: RecordedSpan[]): TraceSpan {
    const rec: RecordedSpan = { name, children: [] };
    into.push(rec);
    return {
      span: (childName) => makeSpan(childName, rec.children),
      end: () => {},
    };
  }
  const tracer: Tracer = {
    span: (name) => makeSpan(name, roots),
    generation: () => ({ end: () => {} }),
    end: () => {},
  };
  return { tracer, roots };
}

function find(roots: readonly RecordedSpan[], name: string): RecordedSpan | undefined {
  for (const r of roots) {
    if (r.name === name) {
      return r;
    }
    const nested = find(r.children, name);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}

describe("graph — worker spans nest under the supervisor span (W2)", () => {
  it("parents worker:evidence_retriever and worker:intake_extractor under one supervisor span", async () => {
    const { tracer, roots } = recordingTracer();
    const graph = buildAgentGraph({
      demographicsTool: foundTool,
      generate: okGenerate,
      supervisor: scriptRouter(["evidence_retriever", "intake_extractor", "ready"]),
      intakeExtractor: async () => ({}),
      evidenceRetriever: async () => ({
        evidence: [{ chunkId: "g::0::0", doc: "guide", section: "S", text: "snippet", score: 0.5 }],
      }),
    });

    await withTracer(tracer, () =>
      graph.invoke({ patientId: "pid-1", messages: [{ role: "user", content: "guideline + doc" }] }),
    );

    // Exactly one supervisor span at the root (reused across hops, not re-created).
    const supervisorRoots = roots.filter((r) => r.name === "supervisor");
    expect(supervisorRoots.length).toBe(1);
    const supervisor = supervisorRoots[0]!;
    const childNames = supervisor.children.map((c) => c.name);
    expect(childNames).toContain("worker:evidence_retriever");
    expect(childNames).toContain("worker:intake_extractor");

    // The worker spans are NOT top-level siblings of the supervisor span.
    expect(roots.map((r) => r.name)).not.toContain("worker:evidence_retriever");
    expect(roots.map((r) => r.name)).not.toContain("worker:intake_extractor");
  });

  it("still answers with no tracer active (nesting is a no-op)", async () => {
    const graph = buildAgentGraph({
      demographicsTool: foundTool,
      generate: okGenerate,
      supervisor: scriptRouter(["intake_extractor", "ready"]),
      intakeExtractor: async () => ({}),
    });
    const out = await graph.invoke({ patientId: "pid-1", messages: [{ role: "user", content: "hi" }] });
    expect(out.answer).toContain("Susan Underwood");
  });
});
