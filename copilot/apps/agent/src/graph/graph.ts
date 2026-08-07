import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import {
  checkCitations,
  checkConstraints,
  checkGroundingWithRegeneration,
  critique,
  applyLlmVeto,
  type Claim,
  type CitationVerdict,
  type ConstraintFinding,
  type RegenerateClaims,
  type WithheldClaim,
} from "@copilot/verification";
import type { MetricsRegistry } from "@copilot/metrics";
import { childSpan, currentTracer, endParentSpan, openParentSpan, tracedSpan } from "../observability/tracing.js";
import { toConstraintFacts } from "./constraintFacts.js";
import { toEvidenceIndex } from "./evidenceIndex.js";
import { collectRetrievedRefs } from "./retrievedRefs.js";
import { renderAnswerBody } from "./renderAnswer.js";
import { decideRoute, type RouteTarget } from "./supervisor.js";
import { isWriteRequest } from "./writeIntent.js";
import { detectOtherPatientRequest } from "./otherPatientIntent.js";
import { detectAssertedAge } from "./assertedIdentity.js";
import type { EvidenceSnippet } from "@copilot/rag";
import type {
  AgentDeps,
  AssembledFacts,
  ChartSource,
  ChatMessage,
  IntakeDocument,
  UngroundedNote,
  Usage,
} from "./types.js";

/** The graceful-degradation message when nothing can be confirmed from the record. */
export const DEGRADED_ANSWER = "I can't confirm that from the record.";

/**
 * Degradation message when the LLM produced no verified prose BUT the deterministic safety
 * layer found something. States the read-only SCOPE ("I only answer from this patient's chart")
 * so an out-of-scope / ungrounded question (a textbook dose, another patient) reads as a proper
 * refusal — not "see the flagged item(s)", which falsely implied the (always-on, unrelated)
 * safety flags were the answer. The flags still render below in their own labeled section.
 */
export const DEGRADED_ANSWER_WITH_FINDINGS =
  "I can only answer from this patient's chart, documents, and the provided guidelines — and I don't have that here.";

/**
 * The read-only-boundary refusal: returned when the physician asks the agent to change chart state
 * (create/update/delete). The co-pilot surfaces and reconciles — it never writes (`USERS.md`
 * non-goals). A clear, single-message answer (no LLM call, no stray safety flags), not the generic
 * "I don't have that here" degrade.
 */
export const READ_ONLY_REFUSAL =
  "I can't write to the chart — I'm read-only. I can surface, reconcile, and flag what's already documented for this patient, but creating, updating, or deleting a record has to be done in OpenEMR directly.";

const EMPTY_FACTS: AssembledFacts = {
  demographics: null,
  problems: null,
  medications: null,
  allergies: null,
  immunizations: null,
  vitals: null,
  labs: null,
  unavailableSources: [],
};

/**
 * Run one chart read in isolation: its own span, its own metric, and — critically —
 * its own failure. A rejected read yields `null` and marks the source *unavailable*,
 * so one OpenEMR FHIR 500 degrades that source rather than failing the whole turn
 * (`.claude/rules/error-handling-and-logging.md`; loadtest/results/ ranked this #2).
 */
async function readSource<T>(
  source: ChartSource,
  deps: Pick<AgentDeps, "metrics" | "logger">,
  read: () => Promise<T>,
): Promise<{ value: T | null; unavailable: boolean }> {
  const startedAt = performance.now();
  const span = currentTracer()?.span(`tool:${source}`);
  try {
    const value = await read();
    span?.end({ output: { ok: true } });
    deps.metrics?.recordToolCall({ tool: source, latencyMs: performance.now() - startedAt, failed: false });
    return { value, unavailable: false };
  } catch (error) {
    span?.end({ error });
    deps.metrics?.recordToolCall({ tool: source, latencyMs: performance.now() - startedAt, failed: true });
    // Log at the recovery boundary so the failed source is visible even when the
    // (opt-in) tracer is off — the turn still degrades to a labeled "unavailable".
    deps.logger?.error({ source, err: String(error) }, "chart source read failed");
    return { value: null, unavailable: true };
  }
}

const AgentState = Annotation.Root({
  patientId: Annotation<string>(),
  messages: Annotation<readonly ChatMessage[]>({ reducer: (_, b) => b, default: () => [] }),
  facts: Annotation<AssembledFacts>({ reducer: (_, b) => b, default: () => EMPTY_FACTS }),
  // False iff generation threw this turn (schema/parse/LLM failure) → the per-encounter
  // `schema_valid` eval category (observability/encounterEval). Default true (no failure).
  generationOk: Annotation<boolean>({ reducer: (_, b) => b, default: () => true }),
  retrievedRefs: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  evidenceIndex: Annotation<Record<string, string>>({ reducer: (_, b) => b, default: () => ({}) }),
  claims: Annotation<Claim[]>({ reducer: (_, b) => b, default: () => [] }),
  verdict: Annotation<CitationVerdict | null>({ reducer: (_, b) => b, default: () => null }),
  groundedClaims: Annotation<Claim[]>({ reducer: (_, b) => b, default: () => [] }),
  ungrounded: Annotation<UngroundedNote[]>({ reducer: (_, b) => b, default: () => [] }),
  // Layer 4: claims the critic gate withheld (uncited or an agent-authored action suggestion).
  // Kept out of the answer body + citation contract; only a count + reason is ever surfaced.
  withheld: Annotation<WithheldClaim[]>({ reducer: (_, b) => b, default: () => [] }),
  // Set when the physician asked the agent to WRITE to the chart — short-circuits generation to a
  // clear read-only refusal (the co-pilot never mutates the chart; `USERS.md` non-goals).
  writeRefusal: Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),
  // Set when the physician asked about a DIFFERENT patient than the bound one → a scoped refusal
  // that names BOTH the requested identifier and the current patient (authorization-and-pid-scope).
  // Handled like writeRefusal, but detected in `gather` so the turn also skips the optional-tool
  // fetch and the worker routing — a cross-patient turn reads nothing it was not already going to.
  otherPatientRefusal: Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),
  // The identifier the physician asked about (e.g. "123456"), echoed back in the refusal so the
  // mismatch is explicit. Null when the phrasing named no id ("another patient").
  requestedPatientRef: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  // Set when the turn ASSERTS a demographic that contradicts the open chart (spec Increment D).
  // The identity is unconfirmed, so the turn returns a challenge instead of clinical detail.
  identityChallenge: Annotation<IdentityMismatch | null>({ reducer: (_, b) => b, default: () => null }),
  findings: Annotation<ConstraintFinding[]>({ reducer: (_, b) => b, default: () => [] }),
  usage: Annotation<Usage | null>({ reducer: (_, b) => b, default: () => null }),
  answer: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
  // W2 supervisor/worker channels. `route` drives the conditional edge; `supervisorHops` +
  // `routedWorkers` bound the loop; `evidence` collects guideline snippets (kept separate from
  // the patient-record `facts`). All default to the W1 no-op state.
  route: Annotation<RouteTarget>({ reducer: (_, b) => b, default: () => "ready" }),
  supervisorHops: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  routedWorkers: Annotation<RouteTarget[]>({ reducer: (_, b) => b, default: () => [] }),
  evidence: Annotation<EvidenceSnippet[]>({ reducer: (_, b) => b, default: () => [] }),
  // On-file documents from the intake-extractor worker (kept separate from `facts` and
  // `evidence` — a document attached to the chart is neither a chart finding nor a guideline).
  // `intakeRan` records that the worker executed, so `generate` can distinguish "we looked and
  // found none" (report "none on file") from "we never looked" (chart-only turn).
  documents: Annotation<IntakeDocument[]>({ reducer: (_, b) => b, default: () => [] }),
  intakeRan: Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),
  // The request correlation id, threaded from the chat route so W2 structured-log events
  // (worker.handoff, retrieval.hit/miss) can carry it. PHI-free; never enters the metrics snapshot.
  correlationId: Annotation<string | undefined>({ reducer: (_, b) => b, default: () => undefined }),
});

// Typed route constants — avoid `as RouteTarget` casts on the bare literals in node returns.
const READY: RouteTarget = "ready";
const INTAKE_EXTRACTOR: RouteTarget = "intake_extractor";
const EVIDENCE_RETRIEVER: RouteTarget = "evidence_retriever";

/** Map a routing decision to the next graph node — `ready` proceeds to generation. */
function routeToNode(route: RouteTarget): "intake_extractor" | "evidence_retriever" | "generate" {
  switch (route) {
    case "intake_extractor":
      return "intake_extractor";
    case "evidence_retriever":
      return "evidence_retriever";
    case "ready":
      return "generate";
  }
}

/** An asserted patient attribute that disagrees with the open chart (spec Increment D). */
export interface IdentityMismatch {
  readonly assertedAge: number;
  readonly documentedAge: number;
}

/**
 * The identity challenge (`docs/specs/auth-bridge-pid-scope.md` Increment D).
 *
 * A consult-framed request that restates who the patient is ("a 58-year-old with CKD") against a
 * chart that documents a different age has NOT established which patient it means. Reporting the
 * discrepancy as a footnote and disclosing the chart anyway is the failure this replaces
 * (`orch-2026-07-24T00-49-18-139Z-2-data-exfiltration-F1`). The challenge names the open chart and
 * its documented age, returns nothing clinical, and asks for a confirmation — which the next turn
 * supplies simply by not repeating the contradicting detail. It is not a lockout: the physician is
 * already authenticated and the pid is already bound by a signed token.
 */
export function renderIdentityChallenge(mismatch: IdentityMismatch, boundName?: string): string {
  const who = boundName !== undefined ? boundName : "the patient whose chart is open";
  return (
    `I can't confirm this is the same patient, so I haven't pulled anything clinical. ` +
    `You described a ${mismatch.assertedAge}-year-old, but the chart that's open is ${who}, ` +
    `documented age ${mismatch.documentedAge}. ` +
    `If that's who you mean, say so and I'll pull the summary; if not, open the correct chart and I'll re-scope.`
  );
}

/**
 * The patient-scope-mismatch refusal (`docs/specs/auth-bridge-pid-scope.md` Increment C).
 *
 * States BOTH sides — the identifier the physician asked about and the patient this session is
 * bound to — so a cross-patient question can never be answered with the bound chart's data under a
 * heading the reader takes for the requested patient (adversarial finding
 * `live-2026-07-22T00-59-05-022Z-F1`). It carries no chart data of its own and tells the physician
 * how to actually switch patients: open that chart in OpenEMR, which mints a new session token.
 */
export function renderScopeMismatch(requestedRef: string | null, boundName?: string): string {
  const bound = boundName !== undefined ? `${boundName}'s chart` : "the chart that is currently open";
  const asked = requestedRef !== null ? `patient ${requestedRef}` : "a different patient";
  const howTo =
    requestedRef !== null
      ? `To review patient ${requestedRef}, open their chart in OpenEMR first and I'll re-scope.`
      : "To review a different patient, open their chart in OpenEMR first and I'll re-scope.";
  return (
    `Patient scope mismatch: you asked about ${asked}, but this session is scoped to ${bound}. ` +
    `I can't return another patient's data, and nothing here is that patient's record — ` +
    `I haven't retrieved it. ${howTo}`
  );
}

/** Render the deterministic safety findings as an appended, labeled section. */
function renderSafetySection(findings: readonly ConstraintFinding[]): string {
  if (findings.length === 0) {
    return "";
  }
  const lines = findings.map((f) => `- [${f.severity}] ${f.message}`);
  return `\n\nSafety flags:\n${lines.join("\n")}`;
}

/**
 * Report that the grounding judge dropped some claims — WITHOUT echoing the model's
 * raw unverified statements. Those strings are exactly the assertions the judge ruled
 * unsupported (potentially fabricated clinical content); rendering them verbatim under
 * a "could not verify" header risks the physician reading the fabrication and missing
 * the caveat. Surface only the count and the judge's reason, not the claim text.
 */
function renderUnverifiedSection(ungrounded: readonly UngroundedNote[]): string {
  if (ungrounded.length === 0) {
    return "";
  }
  const noun = ungrounded.length === 1 ? "statement" : "statements";
  const reasons = [...new Set(ungrounded.map((u) => u.reason))].join("; ");
  return `\n\nNote: ${ungrounded.length} ${noun} could not be verified against the record and ${
    ungrounded.length === 1 ? "was" : "were"
  } omitted (${reasons}).`;
}

/** Human-readable reason for the withheld note — never echoes the withheld statement text. */
const WITHHELD_REASON_TEXT = {
  uncited: "no citation",
  "unsafe-action-suggestion": "recommended a treatment action",
} as const;

/**
 * Report that the critic (layer 4) withheld some claims — WITHOUT echoing the withheld
 * statements (same rule as the ungrounded note: a withheld action suggestion is exactly the
 * text we must not surface). Surface only the count, the reason, and the read-only boundary.
 */
function renderWithheldSection(withheld: readonly WithheldClaim[]): string {
  if (withheld.length === 0) {
    return "";
  }
  const noun = withheld.length === 1 ? "statement" : "statements";
  const reasons = [...new Set(withheld.map((w) => WITHHELD_REASON_TEXT[w.reason]))].join("; ");
  return `\n\nNote: ${withheld.length} ${noun} ${
    withheld.length === 1 ? "was" : "were"
  } withheld by the safety critic (${reasons}) — this assistant surfaces and flags findings, it does not recommend treatment or doses.`;
}

/**
 * Build the agent graph: assembleContext → generate → verify → grounding → constraints →
 * critic → respond.
 *
 * Nodes are thin wrappers over pure modules (the tools, the injected LLM, the
 * citation check, the constraint engine, and the critic). Nothing unverified reaches the
 * answer body: the model's claims are gated by the citation check (layer 1) then the
 * grounding judge (layer 2). The constraint engine (layer 3) computes deterministic safety
 * findings from the *structured* facts — never the prose — and `respond` appends them
 * regardless of whether the LLM body degraded. The critic (layer 4) runs last and vetoes any
 * surviving claim that is uncited or oversteps the read-only boundary into an action
 * suggestion, so a documented conflict is never dropped and a treatment directive never shown.
 */
export function buildAgentGraph(deps: AgentDeps) {
  return new StateGraph(AgentState)
    .addNode("assembleContext", (state) =>
      tracedSpan(
        "assembleContext",
        { patientId: state.patientId },
        async () => {
          const patientId = state.patientId;

          // Each read is isolated: a failure degrades that one source, not the turn.
          // Safety core — fetched every turn (the constraint engine needs meds+allergies+
          // problems even when unasked). Optional sources (vitals/labs/immunizations/…) are
          // fetched by the `gather` node only when the model decides the question needs them.
          const [demographics, problems, medications, allergies] = await Promise.all([
            readSource("demographics", deps, () => deps.demographicsTool({ patientId })),
            readSource("problems", deps, async () =>
              deps.problemsTool === undefined ? null : deps.problemsTool({ patientId }),
            ),
            readSource("medications", deps, async () =>
              deps.medicationsTool === undefined ? null : deps.medicationsTool({ patientId }),
            ),
            readSource("allergies", deps, async () =>
              deps.allergiesTool === undefined ? null : deps.allergiesTool({ patientId }),
            ),
          ]);

          const unavailableSources: ChartSource[] = [];
          for (const [source, result] of [
            ["demographics", demographics],
            ["problems", problems],
            ["medications", medications],
            ["allergies", allergies],
          ] as const) {
            if (result.unavailable) {
              unavailableSources.push(source);
            }
          }

          const demo = demographics.value;
          const facts: AssembledFacts = {
            demographics: demo !== null && demo.found ? demo.demographics : null,
            problems: problems.value,
            medications: medications.value,
            allergies: allergies.value,
            // Optional sources — populated by the gather node if the model fetches them.
            immunizations: null,
            vitals: null,
            labs: null,
            unavailableSources,
          };

          return {
            facts,
            retrievedRefs: collectRetrievedRefs(facts),
            evidenceIndex: toEvidenceIndex(facts),
          };
        },
        (r) => ({ refs: r.retrievedRefs.length }),
      ),
    )
    .addNode("gather", (state) =>
      tracedSpan(
        "gather",
        {},
        async () => {
          // Authorization scope, checked BEFORE any optional read (`authorization-and-pid-scope`;
          // spec Increment C). A turn asking about a different patient must not quietly fetch the
          // BOUND patient's labs and present them as an answer — the finding this guards
          // (`live-2026-07-22T00-59-05-022Z-F1`). Detecting here (rather than at `generate`) means
          // the optional-tool fetch, the worker routing, and the LLM call are all skipped; only the
          // always-on safety core has run, and it read the bound chart, as it does every turn.
          const lastUser = [...state.messages].reverse().find((m) => m.role === "user")?.content ?? "";
          const otherPatient = detectOtherPatientRequest(lastUser);
          if (otherPatient !== null) {
            // Security event — PHI-free by construction: correlation id, the bound patient id, and
            // the (caller-supplied) identifier asked for. Never the patient's name or any chart value.
            deps.logger?.warn(
              {
                correlationId: state.correlationId,
                patientId: state.patientId,
                requestedRef: otherPatient.requestedRef,
              },
              "security.patient_scope_mismatch",
            );
            return { otherPatientRefusal: true, requestedPatientRef: otherPatient.requestedRef };
          }
          // Identity, checked on the same terms (spec Increment D). An asserted age that disagrees
          // with the open chart means we do not know which patient this request is about — so it is
          // challenged BEFORE any clinical disclosure, not footnoted after one.
          const assertedAge = detectAssertedAge(lastUser);
          const documentedAge = state.facts.demographics?.age;
          if (assertedAge !== null && documentedAge !== undefined && assertedAge !== documentedAge) {
            // PHI-free: ages + the bound patient id, never the name.
            deps.logger?.warn(
              {
                correlationId: state.correlationId,
                patientId: state.patientId,
                assertedAge,
                documentedAge,
              },
              "security.patient_identity_mismatch",
            );
            return { identityChallenge: { assertedAge, documentedAge } };
          }
          // Optional-tool fetch. When no gather is wired, run core-only (the constraint
          // engine already has its inputs). The model chooses which optional tools to call;
          // each takes the bound pid from the closure, never a model argument.
          if (deps.gather === undefined) {
            return {};
          }
          const result = await deps.gather({ messages: state.messages, patientId: state.patientId });
          const facts: AssembledFacts = {
            ...state.facts,
            ...result.facts,
            unavailableSources: [...state.facts.unavailableSources, ...result.unavailable],
          };
          return {
            facts,
            retrievedRefs: collectRetrievedRefs(facts),
            evidenceIndex: toEvidenceIndex(facts),
          };
        },
        (r) => ({ gathered: "facts" in r }),
      ),
    )
    // W2 supervisor: after the always-on safety core + gather, decide whether a worker is needed
    // before generating. Typed, bounded, logged (`w2-multi-agent-orchestration`). When no router
    // is injected it is a pure no-op that routes straight to `generate` — the exact W1 flow.
    .addNode("supervisor", async (state) => {
      // ONE supervisor span spans the whole routing cycle (opened on the first hop, reused on later
      // hops), so each worker invocation nests UNDER it (`w2-multi-agent-orchestration`,
      // W2_ARCHITECTURE §9). It is ended only on the terminal decision.
      const span = openParentSpan("supervisor", "supervisor", { firstHop: state.supervisorHops });
      // A refusal / unconfirmed-identity turn has no question to route: skip the workers (and their
      // reads) and head straight for the gate, which still runs — no path bypasses it.
      if (state.otherPatientRefusal || state.identityChallenge !== null) {
        endParentSpan("supervisor", { output: { route: READY, reason: "refusal turn" } });
        return { route: READY };
      }
      if (deps.supervisor === undefined) {
        endParentSpan("supervisor", { output: { route: READY, reason: "no supervisor wired" } });
        return { route: READY };
      }
      const maxHops = deps.supervisorMaxHops ?? 2;
      let raw: unknown;
      try {
        raw = await deps.supervisor({ messages: state.messages, alreadyRouted: state.routedWorkers });
      } catch (error) {
        // A router failure degrades to answering from what we have — never crash the turn.
        endParentSpan("supervisor", { error });
        deps.logger?.error({ err: String(error) }, "supervisor router failed; degrading to ready");
        return { route: READY, supervisorHops: state.supervisorHops + 1 };
      }
      const outcome = decideRoute(raw, {
        hops: state.supervisorHops,
        maxHops,
        alreadyRouted: state.routedWorkers,
      });
      // W2 routing signal: one record per hop. `terminal` marks the ready decision that ends the
      // routing cycle; `hopCapped` marks a ready that the hop cap forced (decideRoute returns the
      // hop-cap outcome at/over the cap) — the loop backstop firing.
      const terminal = outcome.next === READY;
      const hopCapped = terminal && state.supervisorHops >= maxHops;
      deps.metrics?.recordRouting({ target: outcome.next, terminal, hopCapped });
      // Each hop's decision is a child span of the supervisor span (the rationale is on the trace,
      // anti-black-box) — the parent stays open for the worker span to nest beside it.
      span?.span?.("supervisor:decision", { hop: state.supervisorHops }).end({
        output: { route: outcome.next, rationale: outcome.rationale },
      });
      if (!terminal) {
        // A handoff to a worker is a named structured event carrying the correlation id (PHI-free —
        // target + hop only).
        deps.logger?.info(
          { correlationId: state.correlationId, target: outcome.next, hops: state.supervisorHops },
          "worker.handoff",
        );
      } else {
        endParentSpan("supervisor", {
          output: { route: READY, rationale: outcome.rationale, hops: state.supervisorHops },
        });
      }
      return { route: outcome.next, supervisorHops: state.supervisorHops + 1 };
    })
    // Worker: intake-extractor (thin over the injected ingestion port). Collects the patient's
    // on-file documents into `documents` (kept separate from chart facts + guideline evidence),
    // marks itself routed, and edges back to the supervisor. A failure degrades (logged) — the
    // turn still answers, and `intakeRan` still records that we looked.
    .addNode("intake_extractor", async (state) => {
      const span = childSpan("supervisor", "worker:intake_extractor");
      let documents: readonly IntakeDocument[] = [];
      try {
        if (deps.intakeExtractor !== undefined) {
          const result = await deps.intakeExtractor({ patientId: state.patientId, messages: state.messages });
          documents = result.documents ?? [];
        }
        span?.end({ output: { documents: documents.length } });
      } catch (error) {
        span?.end({ error });
        deps.logger?.error({ err: String(error) }, "intake_extractor worker failed");
      }
      // Fold the documents into the turn's citable state, exactly as evidence_retriever folds
      // guideline snippets: each DocumentReference uuid joins the citation whitelist (layer 1)
      // and a short description the grounding index (layer 2), in a namespace distinct from chart
      // rows and guideline chunks so a document claim is gated like any other but never merged.
      const docEntries: Record<string, string> = {};
      for (const d of documents) {
        docEntries[d.provenance.rowUuid] = `Document on file: ${d.title} (type ${d.docType})`;
      }
      return {
        routedWorkers: [...state.routedWorkers, INTAKE_EXTRACTOR],
        documents: [...state.documents, ...documents],
        intakeRan: true,
        retrievedRefs: [...state.retrievedRefs, ...documents.map((d) => d.provenance.rowUuid)],
        // Chart rows win a (theoretical) key collision — a real chart row uuid must never be
        // shadowed by a document's grounding text. DocumentReference ids differ from chart uuids,
        // so no realistic clash; this just makes precedence deterministic.
        evidenceIndex: { ...docEntries, ...state.evidenceIndex },
      };
    })
    // Worker: evidence-retriever (thin over the injected RAG port). Collects guideline snippets
    // into `evidence` (kept separate from patient-record facts), marks routed, back to supervisor.
    .addNode("evidence_retriever", async (state) => {
      const span = childSpan("supervisor", "worker:evidence_retriever");
      let snippets: readonly EvidenceSnippet[] = [];
      let rerank: "used" | "degraded" | undefined;
      try {
        if (deps.evidenceRetriever !== undefined) {
          const result = await deps.evidenceRetriever({ patientId: state.patientId, messages: state.messages });
          snippets = result.evidence ?? [];
          rerank = result.rerank;
        }
        span?.end({ output: { snippets: snippets.length } });
        // W2 structured event: a hit (snippets returned) vs a miss (none). A miss is an absence,
        // never a negative finding (`provenance-and-grounding`). PHI-free — counts + rerank status.
        // Gate on `rerank !== undefined`: it is defined iff `runRetrieval` actually ran a query (and
        // thus recorded the metric). The empty-query early-return leaves it undefined and records no
        // metric — so skipping the log there keeps the log stream and the metric snapshot in agreement.
        if (rerank !== undefined) {
          if (snippets.length > 0) {
            deps.logger?.info(
              { correlationId: state.correlationId, snippets: snippets.length, rerank },
              "retrieval.hit",
            );
          } else {
            deps.logger?.info({ correlationId: state.correlationId, snippets: 0, rerank }, "retrieval.miss");
          }
        }
      } catch (error) {
        span?.end({ error });
        deps.logger?.error({ err: String(error) }, "evidence_retriever worker failed");
      }
      // Fold guideline snippets into the turn's citable state — their chunk ids join the citation
      // whitelist (layer 1) and their text the grounding index (layer 2), in a namespace distinct
      // from chart rows so a guideline claim is gated exactly like a chart claim but never merged.
      const evidenceEntries: Record<string, string> = {};
      for (const s of snippets) {
        evidenceEntries[s.chunkId] = `Guideline (${s.doc} › ${s.section}): ${s.text}`;
      }
      return {
        routedWorkers: [...state.routedWorkers, EVIDENCE_RETRIEVER],
        evidence: [...state.evidence, ...snippets],
        retrievedRefs: [...state.retrievedRefs, ...snippets.map((s) => s.chunkId)],
        // Chart entries win a (theoretical) key collision — a real chart row uuid must never be
        // shadowed by a guideline chunk's grounding text. Chunk ids are `doc::N::N`, uuids differ,
        // so no realistic clash; this just makes the precedence deterministic.
        evidenceIndex: { ...evidenceEntries, ...state.evidenceIndex },
      };
    })
    .addNode("generate", async (state) => {
      // Read-only boundary: a request to change chart state short-circuits BEFORE the LLM call —
      // no generation, and `respond` returns the read-only refusal. The pid is bound and no write
      // tool exists, so this can never mutate anything; it just answers honestly + deterministically.
      const lastUser = [...state.messages].reverse().find((m) => m.role === "user")?.content ?? "";
      if (isWriteRequest(lastUser)) {
        return { claims: [], writeRefusal: true };
      }
      // Authorization scope: a request about a DIFFERENT patient short-circuits BEFORE the LLM call
      // to a refusal naming both the requested id and the bound patient. Normally already decided in
      // `gather`; re-checked here (the detector is pure + idempotent) so the guard holds even if a
      // caller drives `generate` directly.
      const otherPatient = state.otherPatientRefusal ? null : detectOtherPatientRequest(lastUser);
      if (state.otherPatientRefusal || otherPatient !== null) {
        return {
          claims: [],
          otherPatientRefusal: true,
          ...(otherPatient !== null ? { requestedPatientRef: otherPatient.requestedRef } : {}),
        };
      }
      // Unconfirmed identity (spec Increment D): decided in `gather`; nothing clinical is generated.
      if (state.identityChallenge !== null) {
        return { claims: [] };
      }
      const facts = state.facts;
      const generation = currentTracer()?.generation("generate", {
        model: deps.modelName ?? "llm",
        input: { facts, messages: state.messages },
      });
      try {
        const { claims, usage } = await deps.generate({
          messages: state.messages,
          facts,
          ...(state.evidence.length > 0 ? { evidence: state.evidence } : {}),
          // Pass documents iff the intake worker ran this turn: an empty list then means "we
          // looked, found none" (→ report "none on file"); undefined means "never looked".
          ...(state.intakeRan ? { documents: state.documents } : {}),
        });
        generation?.end({ output: { claims }, ...(usage !== undefined ? { usage } : {}) });
        return { claims, usage: usage ?? null };
      } catch (error) {
        // Degrade, never crash the turn (verification-gate rule). A transient LLM
        // failure yields no claims → the body degrades to DEGRADED_ANSWER, but the
        // deterministic constraint findings still surface from the structured facts.
        // The error is surfaced on the trace and the log, not swallowed silently.
        generation?.end({ output: { error: String(error) } });
        deps.logger?.error({ err: String(error) }, "generate failed; degrading turn");
        return { claims: [], usage: null, generationOk: false };
      }
    })
    .addNode("verify", (state) =>
      tracedSpan(
        "verify",
        { claims: state.claims.length },
        async () => ({ verdict: checkCitations(state.claims, state.retrievedRefs) }),
        (r) => ({
          ok: r.verdict.ok,
          verified: r.verdict.verifiedClaims.length,
          rejected: r.verdict.rejectedClaims.length,
        }),
      ),
    )
    .addNode("grounding", (state) =>
      tracedSpan(
        "grounding",
        { claims: state.verdict?.verifiedClaims.length ?? 0 },
        async () => {
          const verified = state.verdict?.verifiedClaims ?? [];
          // Layer 2 is skipped when no judge is wired (tests / cost-off): the
          // citation-verified claims pass through unchanged.
          if (deps.groundingJudge === undefined || verified.length === 0) {
            return { groundedClaims: [...verified], ungrounded: [] };
          }
          const judge = deps.groundingJudge;
          const evidenceFor = (ref: string): string | null => state.evidenceIndex[ref] ?? null;

          // The regenerate seam (verification-gate rule): on a failed grounding check,
          // re-run the model with the judge's feedback. It returns *raw* claims — the
          // pure loop re-gates them through L1 (citation) then L2 (grounding), so this
          // callback can never smuggle an unverified claim past the gate.
          const regenerate: RegenerateClaims = async (feedback) => {
            const span = currentTracer()?.generation("grounding-regenerate", {
              model: deps.modelName ?? "llm",
              input: { feedback },
            });
            try {
              const { claims } = await deps.generate({
                messages: state.messages,
                facts: state.facts,
                feedback,
                ...(state.evidence.length > 0 ? { evidence: state.evidence } : {}),
                ...(state.intakeRan ? { documents: state.documents } : {}),
              });
              span?.end({ output: { claims } });
              return claims;
            } catch (error) {
              span?.end({ output: { error: String(error) } });
              throw error;
            }
          };

          const generation = currentTracer()?.generation("grounding-judge", {
            model: deps.groundingModelName ?? "grounding-judge",
            input: { claims: verified.map((c) => c.statement) },
          });
          const result = await checkGroundingWithRegeneration(
            [...verified],
            state.retrievedRefs,
            evidenceFor,
            judge,
            regenerate,
            { maxRetries: deps.groundingMaxRetries ?? 1 },
          );
          generation?.end({
            output: {
              grounded: result.groundedClaims.length,
              dropped: result.ungroundedClaims.length,
              retries: result.retries,
            },
          });
          // Real source for retries_total (the E4 dashboard shipped it as a labeled
          // zero). Only a fired retry is recorded; a first-attempt success is a no-op.
          if (result.retries > 0) {
            deps.metrics?.recordRetry({ operation: "grounding", attempts: result.retries });
          }
          return {
            groundedClaims: [...result.groundedClaims],
            ungrounded: result.ungroundedClaims.map(
              (u): UngroundedNote => ({ statement: u.claim.statement, reason: u.reason }),
            ),
          };
        },
        (r) => ({ grounded: r.groundedClaims.length, dropped: r.ungrounded.length }),
      ),
    )
    .addNode("constraints", (state) =>
      tracedSpan(
        "constraints",
        {},
        // A write-refusal turn is not a clinical answer to guard — skip the constraint engine so the
        // response is a clean single message (no stray safety flags). The safety core still RAN
        // (assembleContext fetched the facts); only the finding computation is skipped for this turn.
        async () =>
          state.writeRefusal || state.otherPatientRefusal || state.identityChallenge !== null
            ? { findings: [] }
            : { findings: checkConstraints(toConstraintFacts(state.facts)) },
        (r) => ({
          findings: r.findings.length,
          warnings: r.findings.filter((f) => f.severity === "warning").length,
        }),
      ),
    )
    // Layer 4 — the critic gate. Runs LAST in the gate (after the constraint engine, before
    // respond), on the layer-2 grounded claims. It VETOES (withholds) any claim that is uncited
    // or reads as an agent-authored action suggestion — the read-only boundary (UC-4;
    // `W2_ARCHITECTURE §10`). Veto-only: it rewrites `groundedClaims` to the KEPT subset, so both
    // the answer body and the citation contract (built from `groundedClaims`) exclude withheld
    // claims automatically. Deterministic core; an optional injected LLM critic can only tighten.
    .addNode("critic", (state) =>
      tracedSpan(
        "critic",
        { claims: state.groundedClaims.length },
        async () => {
          const det = critique(state.groundedClaims);
          let kept = det.keptClaims;
          const withheld: WithheldClaim[] = [...det.withheldClaims];
          // Optional thin LLM critic (`W2_ARCHITECTURE §10`) — VETO-ONLY: it starts from the
          // deterministic kept set and can only remove more, never approve. A failure degrades to
          // the deterministic result (the turn never crashes) — the guarantee stays deterministic.
          if (deps.critic !== undefined && kept.length > 0) {
            try {
              const flagged = await deps.critic(kept);
              const folded = applyLlmVeto(kept, flagged);
              kept = folded.keptClaims;
              withheld.push(...folded.withheldClaims);
            } catch (error) {
              deps.logger?.error({ err: String(error) }, "llm critic failed; using deterministic critic only");
            }
          }
          return { groundedClaims: [...kept], withheld };
        },
        (r) => ({ kept: r.groundedClaims.length, withheld: r.withheld.length }),
      ),
    )
    .addNode("respond", (state) =>
      tracedSpan(
        "respond",
        {},
        async () => {
          // Read-only boundary: a write request returns the refusal alone — no body/flags/notes.
          if (state.writeRefusal) {
            return { answer: READ_ONLY_REFUSAL };
          }
          // Authorization scope: a cross-patient request returns a refusal that states the MISMATCH
          // — the identifier asked for AND the bound patient — so the answer can never be mistaken
          // for the requested patient's data. Never another patient's chart, no flags.
          if (state.otherPatientRefusal) {
            return { answer: renderScopeMismatch(state.requestedPatientRef, state.facts.demographics?.name) };
          }
          // Unconfirmed identity: challenge first, disclose nothing clinical (spec Increment D).
          if (state.identityChallenge !== null) {
            return {
              answer: renderIdentityChallenge(state.identityChallenge, state.facts.demographics?.name),
            };
          }
          // The answer body is the critic-kept, layer-2 grounded claims (when the judge is
          // unwired, exactly the citation-verified claims that also survived the critic).
          const kept = state.groundedClaims;
          const body =
            kept.length > 0
              ? renderAnswerBody(kept)
              : state.findings.length > 0
                ? DEGRADED_ANSWER_WITH_FINDINGS
                : DEGRADED_ANSWER;
          return {
            answer:
              body +
              renderUnverifiedSection(state.ungrounded) +
              renderWithheldSection(state.withheld) +
              renderSafetySection(state.findings),
          };
        },
        (r) => ({ answerLength: r.answer.length }),
      ),
    )
    .addEdge(START, "assembleContext")
    .addEdge("assembleContext", "gather")
    .addEdge("gather", "supervisor")
    // The supervisor routes to a worker or forward to generate; workers loop back to it. The
    // ONLY exit from this cycle is `generate`, so every path reaches the verification gate below.
    .addConditionalEdges("supervisor", (state) => routeToNode(state.route), {
      intake_extractor: "intake_extractor",
      evidence_retriever: "evidence_retriever",
      generate: "generate",
    })
    .addEdge("intake_extractor", "supervisor")
    .addEdge("evidence_retriever", "supervisor")
    .addEdge("generate", "verify")
    .addEdge("verify", "grounding")
    .addEdge("grounding", "constraints")
    .addEdge("constraints", "critic")
    .addEdge("critic", "respond")
    .addEdge("respond", END)
    .compile();
}
