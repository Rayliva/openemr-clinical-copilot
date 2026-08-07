import type { MetricsRegistry } from "@copilot/metrics";
import type { PatientDemographics, Provenance } from "@copilot/snapshot";
import type { DocType } from "@copilot/ingestion";
import type {
  GetPatientDemographicsResult,
  GetMedicationsResult,
  GetAllergiesResult,
  GetProblemsResult,
  GetImmunizationsResult,
  GetVitalsResult,
  GetLabsResult,
} from "@copilot/tools";
import type {
  Claim,
  CitationVerdict,
  ConstraintFinding,
  GroundingFeedback,
  GroundingJudge,
  LlmCriticFn,
} from "@copilot/verification";
import type { SupervisorRouter } from "./supervisor.js";
import type { EvidenceSnippet } from "@copilot/rag";

/** A single conversation turn (the client sends the full history — multi-turn). */
export interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/**
 * Minimal structured logger the graph nodes use at recovery boundaries, so a tool or
 * LLM failure is visible in the logs even when the (opt-in) tracer is off. Pino's
 * Logger satisfies this shape.
 */
export interface AgentLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
  /** W2 structured events (worker.handoff, retrieval.hit/miss) — object context only, no PHI. */
  info(obj: Record<string, unknown>, msg: string): void;
}

/** The chart sources the agent can assemble. Used as metric + span labels. */
export type ChartSource =
  | "demographics"
  | "problems"
  | "medications"
  | "allergies"
  | "immunizations"
  | "vitals"
  | "labs";

/**
 * Provenance-tagged facts assembled for the turn (the only things the model may
 * cite). `null` means the corresponding tool was not run this turn — distinct from
 * a documented absence (`documented: false`), which the tools carry explicitly.
 *
 * A source listed in `unavailableSources` is a **third** state: the read was
 * attempted and *failed*. That is not an absence, and must never be reported as one
 * (`.claude/rules/provenance-and-grounding.md`: absence ≠ negative finding). A failed
 * medication read means "we could not check", not "no medications".
 */
export interface AssembledFacts {
  readonly demographics: PatientDemographics | null;
  readonly problems: GetProblemsResult | null;
  readonly medications: GetMedicationsResult | null;
  readonly allergies: GetAllergiesResult | null;
  readonly immunizations: GetImmunizationsResult | null;
  readonly vitals: GetVitalsResult | null;
  readonly labs: GetLabsResult | null;
  readonly unavailableSources: readonly ChartSource[];
}

/**
 * A patient document surfaced by the intake-extractor worker (W2). Each carries the
 * `DocumentReference` provenance so a claim about the document (e.g. "an intake form is on
 * file") can cite its row and pass the citation + grounding gate — a document fact without
 * provenance must not be shown (`provenance-and-grounding`). Kept SEPARATE from the extracted
 * clinical facts: this describes a document attached to the chart, not a finding in it.
 */
export interface IntakeDocument {
  /** The document's display title (attachment title), or `""`. */
  readonly title: string;
  /** The classified document type (`lab_pdf` | `intake_form`). */
  readonly docType: DocType;
  /** Provenance tying the document to its `DocumentReference` row (rowUuid = the FHIR id). */
  readonly provenance: Provenance;
}

/** Token/cost accounting from the LLM call (recorded on the trace). */
export interface Usage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly costUsd?: number;
}

export interface GenerateResult {
  readonly claims: Claim[];
  readonly usage?: Usage;
}

/**
 * The LLM boundary. Given the conversation and the assembled facts, return
 * structured claims (each with the provenance it cites). This is the injected
 * seam: a real Claude-backed impl in production, a fake in tests.
 *
 * `feedback`, when present, carries the grounding judge's per-claim reasons from a
 * prior attempt that failed to ground — the bounded regenerate-with-feedback step
 * (`verification-gate` rule). It is absent on the first (normal) call; the generator
 * uses it to revise and tighten, never to widen its claims.
 */
export type GenerateFn = (input: {
  readonly messages: readonly ChatMessage[];
  readonly facts: AssembledFacts;
  readonly feedback?: readonly GroundingFeedback[];
  /**
   * Retrieved guideline evidence (W2). Rendered in a SEPARATE, labeled block from the chart
   * facts and cited by its own `chunkId` namespace — a guideline recommendation is never stated
   * as a chart finding (`w2-multi-agent-orchestration`). Absent on chart-only turns.
   */
  readonly evidence?: readonly EvidenceSnippet[];
  /**
   * On-file documents surfaced by the intake-extractor worker (W2), each cited by its
   * `DocumentReference` provenance. Rendered in its OWN labeled block, distinct from the chart
   * facts and the guideline evidence. Presence is the "we looked" signal: `undefined` → the
   * worker did not run this turn (chart-only, unchanged W1 path); an EMPTY array → the worker ran
   * and found none, so the answer reports "none on file" rather than fabricating a document.
   */
  readonly documents?: readonly IntakeDocument[];
}) => Promise<GenerateResult>;

/** The demographics tool as the graph needs it (the created tool satisfies this). */
export type DemographicsToolFn = (input: {
  readonly patientId: string;
}) => Promise<GetPatientDemographicsResult>;

/** The medications tool as the graph needs it (the created tool satisfies this). */
export type MedicationsToolFn = (input: {
  readonly patientId: string;
}) => Promise<GetMedicationsResult>;

/** The allergies tool as the graph needs it (the created tool satisfies this). */
export type AllergiesToolFn = (input: {
  readonly patientId: string;
}) => Promise<GetAllergiesResult>;

/** The problem-list tool as the graph needs it (the created tool satisfies this). */
export type ProblemsToolFn = (input: {
  readonly patientId: string;
}) => Promise<GetProblemsResult>;

/** The immunization tool as the graph needs it (the created tool satisfies this). */
export type ImmunizationsToolFn = (input: {
  readonly patientId: string;
}) => Promise<GetImmunizationsResult>;

/** The vitals tool as the graph needs it (the created tool satisfies this). */
export type VitalsToolFn = (input: { readonly patientId: string }) => Promise<GetVitalsResult>;

/** The labs tool as the graph needs it (the created tool satisfies this). */
export type LabsToolFn = (input: { readonly patientId: string }) => Promise<GetLabsResult>;

/**
 * The optional facts a gather run fetched, plus any optional sources whose read failed.
 * `facts` sets only the OPTIONAL keys (vitals/labs/immunizations/…) the model chose to fetch.
 */
export interface GatherResult {
  readonly facts: Partial<AssembledFacts>;
  readonly unavailable: readonly ChartSource[];
}

/**
 * The gather seam (agentic tool-calling). Given the conversation + the session-bound pid, the
 * model decides which OPTIONAL tools to call and returns the facts it fetched. Injected — a
 * real Claude tool-calling impl in production, absent in tests (→ core-only, no optional
 * fetch). The pid is bound; the optional tools take NO model-supplied argument
 * (`authorization-and-pid-scope`).
 */
export type GatherFn = (input: {
  readonly messages: readonly ChatMessage[];
  readonly patientId: string;
}) => Promise<GatherResult>;

/**
 * The intake-extractor worker's port (W2). A thin node calls it when the supervisor routes to
 * `intake_extractor`; it wraps `packages/ingestion` to extract a document into a reviewable
 * draft. It does NOT write to the chart and does not block the turn (decoupled review path,
 * `w2-document-ingestion-writes`). Injected — absent → the worker is a no-op handoff.
 */
export type IntakeExtractorFn = (input: {
  readonly patientId: string;
  readonly messages: readonly ChatMessage[];
}) => Promise<{
  /**
   * The patient's on-file documents (provenance-tagged). Optional so a no-op worker may return
   * `{}`; absent is folded to an empty list by the node. Each carries its `DocumentReference`
   * provenance so a document claim can cite it (`provenance-and-grounding`).
   */
  readonly documents?: readonly IntakeDocument[];
}>;

/**
 * The evidence-retriever worker's port (W2). Called when the supervisor routes to
 * `evidence_retriever`; it wraps `packages/rag` to retrieve guideline snippets. Injected —
 * absent → no-op. Guideline evidence is kept SEPARATE from patient-record facts
 * (`w2-multi-agent-orchestration`).
 */
export type EvidenceRetrieverFn = (input: {
  readonly patientId: string;
  readonly messages: readonly ChatMessage[];
}) => Promise<{
  readonly evidence?: readonly EvidenceSnippet[];
  /** W2 observability: whether rerank ran (`used`) or fell back to the fused order (`degraded`). */
  readonly rerank?: "used" | "degraded";
}>;

export interface AgentDeps {
  readonly demographicsTool: DemographicsToolFn;
  /** Safety-core context: the active problem list, always fetched (UC-1/UC-2). */
  readonly problemsTool?: ProblemsToolFn;
  /** Safety-core: meds fetched + reconciled and fed to the constraint gate (UC-3). */
  readonly medicationsTool?: MedicationsToolFn;
  /** Safety-core: allergies fetched and fed to the constraint gate (UC-4). */
  readonly allergiesTool?: AllergiesToolFn;
  readonly generate: GenerateFn;
  /**
   * Optional: the agentic gather step. When present, the model may call optional tools
   * (vitals, labs, immunizations, …) to fetch what THIS question needs; when absent, only the
   * safety core is loaded. The constraint engine never depends on it (it runs on the core).
   */
  readonly gather?: GatherFn;
  /**
   * Optional (W2): the supervisor's routing LLM. When present, after `gather` the supervisor
   * routes to the workers (`intake_extractor`/`evidence_retriever`) before generation, bounded
   * and logged (`w2-multi-agent-orchestration`). When ABSENT, the supervisor node is a no-op
   * that routes straight to `generate` — exactly the W1 flow.
   */
  readonly supervisor?: SupervisorRouter;
  /** Bound on supervisor hops before forcing `ready` (default 2). Keeps the loop from hanging. */
  readonly supervisorMaxHops?: number;
  /** Optional (W2): the intake-extractor worker port. Absent → the worker is a no-op handoff. */
  readonly intakeExtractor?: IntakeExtractorFn;
  /** Optional (W2): the evidence-retriever worker port. Absent → the worker is a no-op handoff. */
  readonly evidenceRetriever?: EvidenceRetrieverFn;
  /** Model label for the LLM generation span (e.g. "claude-sonnet-5"). */
  readonly modelName?: string;
  /**
   * Optional: verification layer 2. When present, each citation-verified claim is
   * judged against its cited evidence and dropped if unsupported. When absent, layer
   * 2 is skipped and citation-verified claims pass through (used in tests / cost-off).
   */
  readonly groundingJudge?: GroundingJudge;
  /** Model label for the grounding-judge span (e.g. "claude-haiku-4-5"). */
  readonly groundingModelName?: string;
  /**
   * Optional: bound on the regenerate-with-feedback loop when a grounding check fails
   * (`verification-gate` rule). Defaults to 1 (a single bounded retry before degrading).
   */
  readonly groundingMaxRetries?: number;
  /**
   * Optional (W2): verification layer 4 — the thin LLM critic (`W2_ARCHITECTURE §10`). It runs
   * AFTER the deterministic critic and is VETO-ONLY: it returns the indexes of kept claims it
   * flags as unsafe action suggestions, and the graph can only remove them (never approve). When
   * ABSENT (the default, incl. tests + the offline eval gate), the deterministic critic alone
   * enforces the read-only boundary — no live call is added to the hot path.
   */
  readonly critic?: LlmCriticFn;
  /**
   * Optional: the live operational metrics window. When present, per-tool calls and
   * failures are recorded. Absent in tests that don't assert on metrics.
   */
  readonly metrics?: MetricsRegistry;
  /** Optional structured logger; failures at graph boundaries are logged to it. */
  readonly logger?: AgentLogger;
}

/** A claim the grounding judge (layer 2) dropped, with why — surfaced for transparency. */
export interface UngroundedNote {
  readonly statement: string;
  readonly reason: string;
}

export interface AgentOutcome {
  readonly answer: string;
  readonly verdict: CitationVerdict;
  readonly usage: Usage | null;
  /** Deterministic safety findings from the constraint engine (layer 3). */
  readonly findings: readonly ConstraintFinding[];
  /** Claims dropped by the grounding judge (layer 2), for the badge. */
  readonly ungrounded: readonly UngroundedNote[];
}
