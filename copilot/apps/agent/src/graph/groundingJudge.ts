import { createAnthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";
import type { GroundingJudge } from "@copilot/verification";

/**
 * The real verification-layer-2 judge: a small, cheap Claude model that decides
 * whether a claim's cited evidence entails the statement. It sees ONLY the evidence
 * rows the claim cites (the graph passes exactly those) — never the whole snapshot
 * (`verification-gate` rule). It can only ever cause a claim to be *dropped*, never
 * add a fact. A thrown error is handled upstream (`checkGrounding` degrades the claim
 * to unverified) so a judge outage never keeps an unverified claim.
 */

const VerdictSchema = z.object({
  grounded: z
    .boolean()
    .describe("True only if the EVIDENCE directly and fully supports the STATEMENT."),
  reason: z
    .string()
    .describe("A brief reason, especially when not grounded (what the evidence lacks)."),
});

const SYSTEM_PROMPT = [
  "You are a strict clinical grounding checker. Decide whether the EVIDENCE (verbatim",
  "rows from ONE patient's chart) supports the STATEMENT.",
  "",
  "Rules:",
  "- Judge ONLY against the EVIDENCE shown. Never use outside medical knowledge.",
  "- grounded=true only if EVERY part of the STATEMENT is directly supported by the EVIDENCE.",
  "- If the STATEMENT adds any detail, drug, value, or status not in the EVIDENCE, grounded=false.",
  "- Absence of evidence is not support. When in doubt, grounded=false.",
].join("\n");

const DEFAULT_JUDGE_TIMEOUT_MS = 30_000;

export interface GroundingJudgeOptions {
  readonly apiKey: string;
  readonly model: string;
  /** Abort a judge call after this many ms (default 30s). */
  readonly timeoutMs?: number;
}

/** Build the injected grounding judge (Claude via the Vercel AI SDK). */
export function createGroundingJudge(options: GroundingJudgeOptions): GroundingJudge {
  const anthropic = createAnthropic({ apiKey: options.apiKey });
  const model = anthropic(options.model);
  const timeoutMs = options.timeoutMs ?? DEFAULT_JUDGE_TIMEOUT_MS;

  return async ({ statement, evidence }) => {
    const evidenceBlock = evidence.map((e, i) => `  [${i + 1}] ${e}`).join("\n");
    const result = await generateObject({
      model,
      schema: VerdictSchema,
      // Newer Claude models accept only the default temperature (see claudeGenerate).
      temperature: 1,
      // Bound the call so a stalled judge cannot hang the turn.
      abortSignal: AbortSignal.timeout(timeoutMs),
      system: SYSTEM_PROMPT,
      prompt: `EVIDENCE:\n${evidenceBlock}\n\nSTATEMENT:\n${statement}`,
    });

    return { grounded: result.object.grounded, reason: result.object.reason };
  };
}
