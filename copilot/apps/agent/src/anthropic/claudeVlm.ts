import { createAnthropic } from "@ai-sdk/anthropic";
import { generateObject, NoObjectGeneratedError, type CoreMessage } from "ai";
import type { z } from "zod";
import {
  LabPdfExtraction,
  IntakeFormExtraction,
  MedicationListExtraction,
  ReferralFaxExtraction,
  type DocType,
  type VlmExtractPort,
  type VlmExtractRequest,
} from "@copilot/ingestion";

/**
 * The concrete Claude-vision implementation of `@copilot/ingestion`'s `VlmExtractPort`
 * (the model-role boundary). Mirrors `createClaudeGenerate`: the app owns the live Anthropic
 * call, the pure package owns the schema-canonical parse + retry/degrade. The port returns
 * RAW model output (`unknown`); the engine validates it. Vision is once-per-document, so the
 * model is Opus-class by default (accuracy over cost) — but always injected, never hardcoded.
 */

/** Vision is slower than text generation; give it a longer default deadline than the chat path. */
const DEFAULT_TIMEOUT_MS = 90_000;

/**
 * A PHI-free transport failure from the VLM call. The provider's own error (Anthropic
 * `APICallError`) carries `requestBodyValues` — i.e. the base64 **page image** and prompt —
 * which must never ride a propagated error into a log (`phi-and-secrets`). We re-throw this
 * instead, preserving only the (PHI-free) status message + code and dropping every structured
 * field; the original is deliberately NOT chained as `cause` (it still holds the body).
 */
export class VlmTransportError extends Error {
  readonly statusCode: number | undefined;
  constructor(message: string, statusCode: number | undefined) {
    super(message);
    this.name = "VlmTransportError";
    this.statusCode = statusCode;
  }
}

/** Extract a numeric HTTP status from an unknown provider error, if present. PHI-free. */
function statusCodeOf(e: unknown): number | undefined {
  if (typeof e === "object" && e !== null && "statusCode" in e) {
    const code = (e as { statusCode: unknown }).statusCode;
    if (typeof code === "number") {
      return code;
    }
  }
  return undefined;
}

/** The canonical schema for a document type. Runtime-selected by `docType`; the engine re-narrows. */
export function selectExtractionSchema(docType: DocType): z.ZodTypeAny {
  switch (docType) {
    case "lab_pdf":
      return LabPdfExtraction;
    case "intake_form":
      return IntakeFormExtraction;
    case "medication_list":
      return MedicationListExtraction;
    case "referral_fax":
      return ReferralFaxExtraction;
  }
}

const FIELD_LIST: Record<DocType, string> = {
  lab_pdf:
    "each lab result: testName, value (as printed — keep '<5.7', 'Negative' as strings), unit, referenceRange, collectionDate, abnormalFlag, and a citation + confidence",
  intake_form:
    "demographics, chiefConcern, currentMedications, allergies, familyHistory — each list item with its own citation + confidence",
  medication_list:
    "medications — each with name, dose, frequency, and status (all exactly as printed), plus its own citation + confidence",
  referral_fax:
    "referralDate, referringProvider, referredTo, reason, diagnosis — each a single field (omit any not printed) with its value exactly as printed, plus its own citation + confidence",
};

function buildSystemPrompt(docType: DocType): string {
  return [
    "You are a clinical document-extraction model. You are shown the page image(s) of one",
    `${docType} document and must extract it into the required structured schema.`,
    "",
    "Absolute rules — a wrong value here can become chart data:",
    "- Use ONLY what is visibly printed on the page(s). Do NOT infer, calculate, normalize,",
    "  or invent any value that is not literally shown. A field that is not on the page is",
    "  absent — omit it (or leave it empty); never fill it with a plausible guess.",
    "- For every extracted field, set `quoteOrValue` in its citation to the exact text as",
    "  printed on the page, and set `confidence` in [0,1] to how clearly you could read it.",
    "- Set `pageOrSection` to the page or section where the value appears; set `sourceType`",
    `  to "${docType}".`,
    `- Extract: ${FIELD_LIST[docType]}.`,
    "Return every field the schema requires; if a value is genuinely unreadable, give it a",
    "low confidence rather than omitting a required field or inventing a value.",
  ].join("\n");
}

/** The prompt + messages sent to the VLM for one extraction attempt. Pure — unit-tested. */
export interface VlmMessages {
  readonly system: string;
  readonly messages: CoreMessage[];
}

/**
 * Build the system prompt + a single user message carrying the instruction text and one image
 * part per page. On a retry, the engine's schema feedback is threaded into the instruction so
 * the model corrects exactly what failed.
 */
export function buildVlmMessages(request: VlmExtractRequest): VlmMessages {
  const imageParts = request.pages.map((p) => ({
    type: "image" as const,
    image: p.base64,
    mimeType: p.mediaType,
  }));

  const instruction =
    request.feedback === undefined
      ? `Extract this ${request.docType} document into the required schema now.`
      : [
          `Your previous extraction of this ${request.docType} document did not conform to the`,
          "schema. Fix exactly these problems and return the full document again — do not invent",
          "values to fill gaps:",
          request.feedback,
        ].join("\n");

  const messages: CoreMessage[] = [
    { role: "user", content: [{ type: "text", text: instruction }, ...imageParts] },
  ];
  return { system: buildSystemPrompt(request.docType), messages };
}

/**
 * The model-call seam. Returns the generated object, or throws (NoObjectGeneratedError on a
 * malformed generation, or a transport error). Injected in tests; defaults to the real AI SDK.
 */
export type RunGenerate = (params: {
  readonly system: string;
  readonly messages: CoreMessage[];
  readonly schema: z.ZodTypeAny;
  readonly signal: AbortSignal;
}) => Promise<unknown>;

export interface ClaudeVlmOptions {
  readonly apiKey: string;
  readonly model: string;
  /** Abort the VLM call after this many ms (default 90s). Bounds the ingestion hot path. */
  readonly timeoutMs?: number;
  /** Injected model call for offline tests; defaults to the real `generateObject` path. */
  readonly runGenerate?: RunGenerate;
}

function realRunGenerate(apiKey: string, model: string): RunGenerate {
  const anthropic = createAnthropic({ apiKey });
  const llm = anthropic(model);
  return async ({ system, messages, schema, signal }) => {
    const result = await generateObject({
      model: llm,
      schema,
      // Opus/Sonnet accept only the default temperature; passing 1 explicitly avoids a reject.
      temperature: 1,
      abortSignal: signal,
      system,
      messages,
    });
    return result.object;
  };
}

/**
 * Best-effort parse of the model's raw text so the ENGINE receives a JSON value to reject and
 * drive its bounded retry/degrade — a malformed generation must never crash the ingestion, and
 * must never bypass the schema (`w2-document-ingestion-writes`).
 */
function coerceRawText(text: string | undefined): unknown {
  if (text === undefined) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { __unparsed: text };
  }
}

export function createClaudeVlm(options: ClaudeVlmOptions): VlmExtractPort {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const run = options.runGenerate ?? realRunGenerate(options.apiKey, options.model);

  return async (request) => {
    // A document with no pages is a caller bug, not a model failure — fail fast and honestly
    // rather than sending the model a text-only prompt it can only hallucinate against.
    if (request.pages.length === 0) {
      throw new Error("createClaudeVlm: extract called with no page images");
    }

    const { system, messages } = buildVlmMessages(request);
    const schema = selectExtractionSchema(request.docType);
    try {
      return await run({ system, messages, schema, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      // A malformed generation is a schema concern the engine handles (retry/degrade), NOT a
      // crash — hand back the raw text. Everything else (timeout, auth, rate limit) is transport
      // and propagates: the port owns transport, the engine owns schema-conformance. We re-throw
      // transport failures as a PHI-free VlmTransportError so the provider error's base64 page
      // image can never ride into a log downstream.
      if (NoObjectGeneratedError.isInstance(e)) {
        return coerceRawText(e.text);
      }
      const message = e instanceof Error ? e.message : "unknown VLM transport error";
      throw new VlmTransportError(message, statusCodeOf(e));
    }
  };
}
