import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  OpenEmrFhirClient,
  OpenEmrTokenClient,
  importRs384PrivateKey,
} from "@copilot/openemr-client";
import {
  chunkMarkdown,
  buildIndex,
  retrieveEvidence,
  rerankEvidence,
  type GuidelineChunk,
  type RerankFn,
} from "@copilot/rag";
import { createCohereEmbed } from "../cohere/cohereEmbed.js";
import { createCohereRerank } from "../cohere/cohereRerank.js";
import { createCircuitBreaker } from "../cohere/circuitBreaker.js";
import { createClaudeSupervisor } from "../anthropic/claudeSupervisor.js";
import {
  createGetPatientDemographics,
  createGetMedications,
  createGetAllergies,
  createGetProblems,
  createGetImmunizations,
  createGetVitals,
  createGetLabs,
} from "@copilot/tools";
import type { MetricsRegistry } from "@copilot/metrics";
import type { GroundingJudge } from "@copilot/verification";
import { stubGenerate } from "../graph/stubGenerate.js";
import { createClaudeGather, type OptionalToolSpec } from "../graph/gather.js";
import type {
  AgentDeps,
  GenerateFn,
  EvidenceRetrieverFn,
  IntakeExtractorFn,
  IntakeDocument,
  ChatMessage,
} from "../graph/types.js";
import { runRetrieval } from "./retrieval.js";
import { classifyDocType, detectPendingDocuments } from "@copilot/ingestion";
import { provenanceOf } from "@copilot/snapshot";

export type OpenEmrFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface WireAgentOptions {
  readonly copilotRoot: string;
  readonly openemrBaseUrl: string;
  readonly openemrFetch: OpenEmrFetch;
  /** The LLM generate function; falls back to the dev stub when omitted. */
  readonly generate?: GenerateFn;
  /** Model label for the generation span (e.g. "claude-sonnet-5" or "dev-stub"). */
  readonly modelName?: string;
  /** Optional verification-layer-2 grounding judge; when omitted, layer 2 is skipped. */
  readonly groundingJudge?: GroundingJudge;
  /** Model label for the grounding-judge span (e.g. "claude-haiku-4-5"). */
  readonly groundingModelName?: string;
  /** Live operational metrics window; per-tool calls/failures are recorded to it. */
  readonly metrics?: MetricsRegistry;
  /**
   * Optional: enables the agentic gather step (the model selects which optional tools —
   * vitals, labs, immunizations — to call). Absent → core-only (no optional fetch).
   */
  readonly gather?: { readonly apiKey: string; readonly model: string };
  /**
   * Optional (W2): enables guideline RAG. Builds the corpus index at startup (Cohere embed) and
   * wires the evidence-retriever worker. Absent, or if index build fails, → no RAG (chart-only).
   */
  readonly rag?: { readonly cohereApiKey: string };
  /**
   * Optional (W2): the supervisor's routing LLM. Only takes effect when a worker is wired (RAG).
   */
  readonly supervisor?: { readonly apiKey: string; readonly model: string };
}

/** Most recent user message text, or null. The retrieval query for the evidence-retriever. */
function lastUserText(messages: readonly ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m !== undefined && m.role === "user") {
      return m.content;
    }
  }
  return null;
}

/**
 * Build the evidence-retriever worker: index the committed guideline corpus once at startup
 * (Cohere embed), then per call retrieve (dense+keyword→RRF) + rerank the latest user question.
 * Throws if the index cannot be built (caller degrades to chart-only).
 */
async function buildEvidenceRetriever(
  cohereApiKey: string,
  corpusDir: string,
  metrics?: MetricsRegistry,
): Promise<EvidenceRetrieverFn> {
  const files = (await readdir(corpusDir)).filter((f) => f.endsWith(".md"));
  const chunks: GuidelineChunk[] = [];
  for (const file of files) {
    const markdown = await readFile(resolve(corpusDir, file), "utf8");
    chunks.push(...chunkMarkdown({ id: file.replace(/\.md$/, ""), markdown }));
  }
  const queryEmbed = createCohereEmbed({ apiKey: cohereApiKey, inputType: "search_query" });
  const rawRerank = createCohereRerank({ apiKey: cohereApiKey });
  // Circuit-break the reranker: after repeated Cohere failures (e.g. a trial-key rate-limit burst) the
  // breaker opens and fails fast, so retrieval degrades to the fused order immediately instead of paying
  // a per-request timeout to a service that is down. `rerankEvidence`'s try/catch turns the resulting
  // CircuitOpenError into the fused fallback (reranked:false) — same behaviour, faster degrade.
  const rerankBreaker = createCircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 });
  const rerank: RerankFn = (query, documents) => rerankBreaker.run(() => rawRerank(query, documents));
  const index = await buildIndex(chunks, createCohereEmbed({ apiKey: cohereApiKey, inputType: "search_document" }));

  return async ({ messages }) => {
    const query = lastUserText(messages);
    if (query === null) {
      return { evidence: [] };
    }
    // The W2 retrieval signals (hits, rerank used-vs-degraded, latency) are recorded in this pure
    // helper — the one place retrieve + rerank happen distinctly.
    const outcome = await runRetrieval(
      query,
      {
        fusedRetrieve: (q) => retrieveEvidence(q, index, queryEmbed, { topK: 8 }),
        rerank: (q, fused) => rerankEvidence(q, fused, rerank, { topN: 3 }),
      },
      metrics,
    );
    return { evidence: outcome.evidence, rerank: outcome.rerank };
  };
}

/**
 * The OAuth client-metadata file is a config boundary — parse it with Zod like every
 * other boundary rather than trusting an `as` cast. A malformed file then cleanly
 * disables `/chat` (returns null) instead of crashing obscurely at `meta.scope.split`.
 */
// Validate the fields the agent uses; TOLERATE extra keys. The OAuth registration writes
// additional fields (e.g. `base_url`), and a strict schema here rejected the real file,
// so wiring returned null and /chat silently failed to register. Default Zod object
// behaviour (strip unknowns) is exactly right — never `.strict()` on an external file we
// don't fully own the shape of.
export const ClientMetaSchema = z.object({
  client_id: z.string().min(1),
  kid: z.string().min(1),
  scope: z.string().min(1),
});
type ClientMeta = z.infer<typeof ClientMetaSchema>;

/**
 * Assemble the agent's runtime deps: the demographics tool backed by the real
 * OpenEMR FHIR client (using the OAuth client registered in `.secrets`), and the
 * generate function. Returns null when no client is registered, so `/chat` is
 * simply not exposed.
 */
export async function wireAgentDeps(options: WireAgentOptions): Promise<AgentDeps | null> {
  const secretsDir = resolve(options.copilotRoot, ".secrets");

  let meta: ClientMeta;
  let pem: string;
  try {
    const rawMeta: unknown = JSON.parse(
      await readFile(resolve(secretsDir, "openemr-client.json"), "utf8"),
    );
    meta = ClientMetaSchema.parse(rawMeta);
    pem = await readFile(resolve(secretsDir, "openemr-private-key.pem"), "utf8");
  } catch {
    // Missing, unreadable, or malformed config: disable /chat cleanly rather than
    // starting up in a broken half-configured state.
    return null;
  }

  const privateKey = await importRs384PrivateKey(pem);
  const scope = meta.scope
    .split(" ")
    .filter((s) => s !== "openid")
    .join(" ");

  const tokens = new OpenEmrTokenClient({
    baseUrl: options.openemrBaseUrl,
    clientId: meta.client_id,
    privateKey,
    scope,
    kid: meta.kid,
    fetchFn: options.openemrFetch,
  });
  const fhir = new OpenEmrFhirClient({
    baseUrl: options.openemrBaseUrl,
    getAccessToken: () => tokens.getAccessToken(),
    fetchFn: options.openemrFetch,
  });

  // Optional tools the gather step may call — the model decides which the question needs.
  // Each `run` takes the bound pid from the closure (never a model argument) and summarizes
  // the result so the model can judge whether it has enough.
  const vitalsTool = createGetVitals({ fhir });
  const labsTool = createGetLabs({ fhir });
  const immunizationsTool = createGetImmunizations({ fhir });
  const gatherSpecs: OptionalToolSpec[] = [
    {
      name: "getVitals",
      source: "vitals",
      description:
        "Latest vital signs: blood pressure, heart rate, weight, height, BMI, temperature, oxygen saturation.",
      run: async (pid, acc) => {
        const r = await vitalsTool({ patientId: pid });
        acc.vitals = r;
        return r.documented ? `Fetched ${r.observations.length} vital-sign reading(s).` : "No vital signs documented.";
      },
    },
    {
      name: "getLabs",
      source: "labs",
      description:
        "Latest laboratory results: A1c, lipid panel, metabolic panel, CBC, kidney/liver function, and other labs.",
      run: async (pid, acc) => {
        const r = await labsTool({ patientId: pid });
        acc.labs = r;
        return r.documented ? `Fetched ${r.observations.length} lab result(s).` : "No lab results documented.";
      },
    },
    {
      name: "getImmunizations",
      source: "immunizations",
      description: "Immunizations / vaccines on file for this patient.",
      run: async (pid, acc) => {
        const r = await immunizationsTool({ patientId: pid });
        acc.immunizations = r;
        return r.documented ? `Fetched ${r.immunizations.length} immunization(s).` : "No immunizations documented.";
      },
    },
  ];

  // W2 guideline RAG: index the corpus + wire the evidence-retriever. Resilient — if the corpus
  // can't be indexed (e.g. Cohere unreachable at startup), skip RAG and run W1 chart-only.
  let evidenceRetriever: EvidenceRetrieverFn | undefined;
  if (options.rag !== undefined) {
    try {
      evidenceRetriever = await buildEvidenceRetriever(
        options.rag.cohereApiKey,
        resolve(options.copilotRoot, "packages/rag/corpus"),
        options.metrics,
      );
    } catch (error) {
      // Startup infra failure (no PHI) — log and continue without RAG rather than fail the agent.
      console.warn(`[wire] guideline RAG disabled: could not build corpus index (${String(error)})`);
    }
  }
  // W2 intake-extractor worker: thin over the ingestion package — detects the patient's uploaded
  // documents (+ their type) so the supervisor can route a document question to it. Always available
  // (detection needs only the FHIR client); yields an empty list when the patient has no documents.
  const intakeExtractor: IntakeExtractorFn = async ({ patientId }) => {
    const bundle = await fhir.search("DocumentReference", { patient: patientId });
    // One fetch time for the batch — every document read in this call shares it (provenance
    // `fetchedAt`). rowUuid is the DocumentReference id, so a claim about the document can cite it
    // and pass the citation + grounding gate (`provenance-and-grounding`).
    const fetchedAt = new Date();
    const documents: IntakeDocument[] = detectPendingDocuments(bundle, new Set()).map((d) => ({
      title: d.title,
      docType: classifyDocType(d),
      provenance: provenanceOf("documents", d.documentId, fetchedAt),
    }));
    return { documents };
  };

  // The supervisor routes to whichever workers are wired: intake_extractor is always available;
  // evidence_retriever only when the guideline RAG corpus indexed at startup.
  const availableWorkers: ("intake_extractor" | "evidence_retriever")[] = ["intake_extractor"];
  if (evidenceRetriever !== undefined) {
    availableWorkers.push("evidence_retriever");
  }
  const supervisor =
    options.supervisor !== undefined
      ? createClaudeSupervisor({
          apiKey: options.supervisor.apiKey,
          model: options.supervisor.model,
          availableWorkers,
        })
      : undefined;

  return {
    demographicsTool: createGetPatientDemographics({ fhir }),
    problemsTool: createGetProblems({ fhir }),
    medicationsTool: createGetMedications({ fhir }),
    allergiesTool: createGetAllergies({ fhir }),
    generate: options.generate ?? stubGenerate,
    modelName: options.modelName ?? "dev-stub",
    intakeExtractor,
    ...(evidenceRetriever !== undefined ? { evidenceRetriever } : {}),
    ...(supervisor !== undefined ? { supervisor } : {}),
    ...(options.gather !== undefined
      ? { gather: createClaudeGather({ apiKey: options.gather.apiKey, model: options.gather.model, specs: gatherSpecs }) }
      : {}),
    ...(options.groundingJudge !== undefined ? { groundingJudge: options.groundingJudge } : {}),
    ...(options.groundingModelName !== undefined
      ? { groundingModelName: options.groundingModelName }
      : {}),
    ...(options.metrics !== undefined ? { metrics: options.metrics } : {}),
  };
}
