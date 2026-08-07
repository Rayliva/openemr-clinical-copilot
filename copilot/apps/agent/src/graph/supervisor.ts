import { z } from "zod";

/**
 * The supervisor's routing decision — the typed, logged, bounded contract that keeps the
 * multi-agent graph from becoming a black box (`w2-multi-agent-orchestration`). The supervisor
 * never acts on raw model text: it parses the router's output against `RouteDecision`, bounds the
 * hops, and always converges to `ready`. This module is the pure decision logic; the model call
 * and the graph wiring are elsewhere (injected router; graph-wiring slice).
 */

/** Where the supervisor may route. `ready` = no more workers needed → proceed to generation. */
export const RouteTarget = z.enum(["intake_extractor", "evidence_retriever", "ready"]);
export type RouteTarget = z.infer<typeof RouteTarget>;

/** The typed routing decision. `rationale` is logged on every hop (anti-black-box). */
export const RouteDecision = z.object({
  next: RouteTarget,
  rationale: z.string().min(1),
});
export type RouteDecision = z.infer<typeof RouteDecision>;

/** The injected supervisor model call. Returns RAW output; `decideRoute` validates it. */
export type SupervisorRouter = (input: {
  readonly messages: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
  readonly alreadyRouted: readonly RouteTarget[];
}) => Promise<unknown>;

export interface RouteContext {
  /** How many supervisor hops have already happened this turn. */
  readonly hops: number;
  /** The hop cap — at or beyond it, routing is forced to `ready` (bounded, never hangs). */
  readonly maxHops: number;
  /** Workers already invoked this turn — each contributes at most once. */
  readonly alreadyRouted: readonly RouteTarget[];
}

export interface RoutingOutcome {
  readonly next: RouteTarget;
  readonly rationale: string;
}

const READY_HOP_CAP: RoutingOutcome = {
  next: "ready",
  rationale: "supervisor hop limit reached; proceeding to answer (bounded)",
};
const READY_PARSE_FAIL: RoutingOutcome = {
  next: "ready",
  rationale: "supervisor output did not parse to a valid decision; proceeding to answer",
};

/**
 * Turn the router's raw output into a bounded, valid routing outcome. **Total** (never throws)
 * and **convergent** (always reaches `ready`): the hop cap and the already-routed guard bound
 * the loop, and any un-parseable / unknown decision degrades to `ready` rather than routing on
 * garbage. Every outcome carries a non-empty rationale so the handoff log always has a reason.
 */
export function decideRoute(raw: unknown, ctx: RouteContext): RoutingOutcome {
  // Bound first: at/over the cap, a graph that never reaches `ready` must degrade, not hang.
  if (ctx.hops >= ctx.maxHops) {
    return READY_HOP_CAP;
  }

  const parsed = RouteDecision.safeParse(raw);
  if (!parsed.success) {
    return READY_PARSE_FAIL;
  }

  const decision = parsed.data;
  // A worker contributes once per turn — re-routing to it would oscillate under the cap.
  if (decision.next !== "ready" && ctx.alreadyRouted.includes(decision.next)) {
    return {
      next: "ready",
      rationale: `worker "${decision.next}" already ran this turn; proceeding to answer`,
    };
  }

  return { next: decision.next, rationale: decision.rationale };
}
