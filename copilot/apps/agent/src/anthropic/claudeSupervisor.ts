import { createAnthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { RouteDecision, type RouteTarget, type SupervisorRouter } from "../graph/supervisor.js";

/**
 * The concrete Claude supervisor router: emits a typed `RouteDecision` (never raw text) deciding
 * the next worker or `ready`. Thin — the bounded/degrade logic is the pure `decideRoute`; here we
 * only build the prompt, call the model, and constrain the choice to workers actually wired this
 * run (so it never routes to a no-op). `w2-multi-agent-orchestration`.
 */

type WorkerTarget = Exclude<RouteTarget, "ready">;

const WORKER_DESCRIPTION: Record<WorkerTarget, string> = {
  evidence_retriever:
    "evidence_retriever — retrieves clinical-guideline evidence. Route here when the question asks what a guideline or standard of care recommends, or for the evidence behind a recommendation.",
  intake_extractor:
    "intake_extractor — extracts an uploaded clinical document (lab PDF / intake form). Route here when the physician asks to process or read an uploaded document.",
};

/** Build the supervisor system prompt, offering only the wired workers. Pure. */
export function buildSupervisorPrompt(
  availableWorkers: readonly WorkerTarget[],
  alreadyRouted: readonly RouteTarget[],
): string {
  const workers = availableWorkers.map((w) => `- ${WORKER_DESCRIPTION[w]}`).join("\n");
  const used =
    alreadyRouted.length > 0 ? `Already used this turn (do NOT repeat): ${alreadyRouted.join(", ")}.` : "";
  return [
    "You are the supervisor of a clinical co-pilot. Decide the SINGLE next step for THIS turn.",
    "The patient's chart (demographics, problems, medications, allergies, vitals, labs) is ALWAYS already loaded — do NOT route to a worker for a question answerable from the chart alone.",
    "Available workers:",
    workers,
    "Return `ready` when no worker is needed (a chart-only question) or all needed workers have already run.",
    used,
    "Respond with the routing decision and a one-sentence rationale.",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * Constrain the model's raw decision to a valid, wired choice. Pure: unparseable → `ready`; a pick
 * of a worker not wired this run → `ready` (never route to a no-op). `decideRoute` still bounds it
 * downstream.
 */
export function constrainToAvailable(
  raw: unknown,
  availableWorkers: readonly WorkerTarget[],
): { readonly next: RouteTarget; readonly rationale: string } {
  const parsed = RouteDecision.safeParse(raw);
  if (!parsed.success) {
    return { next: "ready", rationale: "supervisor output did not parse; proceeding to answer" };
  }
  const decision = parsed.data;
  if (decision.next !== "ready" && !availableWorkers.includes(decision.next)) {
    return { next: "ready", rationale: `worker "${decision.next}" is not wired this run; proceeding` };
  }
  return decision;
}

export interface ClaudeSupervisorOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs?: number;
  /** Workers actually wired this run — the router only offers and only routes to these. */
  readonly availableWorkers: readonly WorkerTarget[];
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function createClaudeSupervisor(options: ClaudeSupervisorOptions): SupervisorRouter {
  const anthropic = createAnthropic({ apiKey: options.apiKey });
  const model = anthropic(options.model);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async ({ messages, alreadyRouted }) => {
    const result = await generateObject({
      model,
      schema: RouteDecision,
      temperature: 1,
      abortSignal: AbortSignal.timeout(timeoutMs),
      system: buildSupervisorPrompt(options.availableWorkers, alreadyRouted),
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    return constrainToAvailable(result.object, options.availableWorkers);
  };
}
