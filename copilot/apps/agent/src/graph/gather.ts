import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, tool } from "ai";
import { z } from "zod";
import type { AssembledFacts, ChartSource, GatherFn } from "./types.js";

/** A mutable view of the optional facts a gather run accumulates. */
type MutableFacts = { -readonly [K in keyof AssembledFacts]?: AssembledFacts[K] };

/**
 * One optional tool offered to the gather model. `run` fetches via the real tool (closing
 * over the bound pid), writes the result into the accumulator, and returns a short summary
 * the model uses to decide whether it needs more. `source` labels the read if it fails.
 *
 * The tool exposes NO parameters to the model — the pid comes from the closure, never a
 * model-supplied argument (`authorization-and-pid-scope`).
 */
export interface OptionalToolSpec {
  readonly name: string;
  readonly description: string;
  readonly source: ChartSource;
  readonly run: (patientId: string, acc: MutableFacts) => Promise<string>;
}

const GATHER_SYSTEM = [
  "You are the data-gathering step for a clinical co-pilot answering a question about ONE patient.",
  "The core chart — demographics, problems, medications, allergies — is ALREADY loaded; do NOT try to fetch it.",
  "Call ONLY the tools whose data is needed to answer the LAST user message. If no extra data is needed, call nothing.",
  "Earlier assistant turns are prior answers, NOT a data source: fetch the data the LAST user message needs even if a previous answer already mentioned it.",
  "Do NOT answer the question. Your only job is to call the right tools; a separate step writes the answer.",
].join("\n");

/** Placeholder that replaces a prior assistant answer — carries no chart data. */
const ASSISTANT_PLACEHOLDER = "[earlier answer — not a data source]";

/** A conversation turn as gather consumes it. */
export interface GatherHistoryMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/**
 * Prepare the conversation for the gather (tool-selection) model. Prior ASSISTANT turns
 * are the co-pilot's own earlier answers — not a data source. Left intact they fool the
 * model into skipping a fetch ("the flu-shot date is already in the transcript"), which
 * then cannot be grounded because facts are rebuilt from tools each turn. Replace assistant
 * content with a data-free placeholder (role preserved, so turn structure/alternation stays
 * intact); user turns pass through unchanged so follow-up context is kept.
 */
export function sanitizeGatherHistory(
  messages: readonly GatherHistoryMessage[],
): GatherHistoryMessage[] {
  return messages.map((m) =>
    m.role === "assistant" ? { role: "assistant", content: ASSISTANT_PLACEHOLDER } : { role: "user", content: m.content },
  );
}

/** Deadline on the gather call so a stalled provider degrades (to core-only), not hangs. */
const DEFAULT_GATHER_TIMEOUT_MS = 30_000;

export interface ClaudeGatherOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly specs: readonly OptionalToolSpec[];
  /** Abort the gather after this many ms (default 30s). */
  readonly timeoutMs?: number;
}

/**
 * The real gather impl: a bounded Claude tool-calling loop. The model is shown the optional
 * tools and calls the ones this question needs; each call fetches via the real tool and
 * accumulates the facts. The model's text output is discarded — gather only fetches; the
 * answer is written later by the pure `generate` node, so the verification gate is unchanged.
 *
 * Degrades gracefully: a tool read failure marks that source unavailable (not absent), and a
 * provider/timeout error falls back to whatever was fetched so far (possibly nothing).
 */
export function createClaudeGather(options: ClaudeGatherOptions): GatherFn {
  const anthropic = createAnthropic({ apiKey: options.apiKey });
  const model = anthropic(options.model);
  const timeoutMs = options.timeoutMs ?? DEFAULT_GATHER_TIMEOUT_MS;

  return async ({ messages, patientId }) => {
    const acc: MutableFacts = {};
    const unavailable: ChartSource[] = [];

    const tools = Object.fromEntries(
      options.specs.map((spec) => [
        spec.name,
        tool({
          description: spec.description,
          parameters: z.object({}),
          execute: async () => {
            try {
              return await spec.run(patientId, acc);
            } catch {
              if (!unavailable.includes(spec.source)) {
                unavailable.push(spec.source);
              }
              return `${spec.name}: read failed (source unavailable).`;
            }
          },
        }),
      ]),
    );

    try {
      await generateText({
        model,
        system: GATHER_SYSTEM,
        messages: sanitizeGatherHistory(messages),
        tools,
        maxSteps: options.specs.length + 1,
        temperature: 1,
        abortSignal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // Gather failed (timeout / provider error): degrade to whatever was fetched. The turn
      // still answers from the safety core + any optional facts already gathered.
    }

    return { facts: acc, unavailable };
  };
}
