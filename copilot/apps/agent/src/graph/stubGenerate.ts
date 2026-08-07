import type { GenerateFn } from "./types.js";

/**
 * DEV-ONLY deterministic stand-in for the LLM. It emits a single grounded claim
 * built from the assembled facts (citing their provenance), so `/chat` runs
 * end-to-end without an Anthropic key — useful for exercising the tool, graph,
 * verification, and SSE without spending a token. Replaced by the real
 * Claude-backed generate when ANTHROPIC_API_KEY is set. Never for production.
 */
export const stubGenerate: GenerateFn = async ({ facts }) => {
  const demo = facts.demographics;
  if (demo === null) {
    // No record retrieved → nothing to ground a claim on; the graph will degrade.
    return { claims: [], usage: { promptTokens: 0, completionTokens: 0, costUsd: 0 } };
  }

  const parts = [
    demo.name,
    demo.birthDate !== undefined ? `DOB ${demo.birthDate}` : null,
    demo.gender ?? null,
  ].filter((part): part is string => typeof part === "string" && part.length > 0);

  return {
    claims: [{ statement: `Patient: ${parts.join(", ")}.`, sourceRefs: [demo.provenance.rowUuid] }],
    usage: { promptTokens: 0, completionTokens: 0, costUsd: 0 },
  };
};
