import { z } from "zod";
import type { EmbedFn } from "@copilot/rag";

/**
 * The concrete Cohere embed v3 implementation of `@copilot/rag`'s injected `EmbedFn`. Thin adapter:
 * the app owns the network call; the pure package owns retrieval. Cohere v3 uses distinct
 * `input_type`s for documents vs queries (comparable embedding space), so create one embedder per
 * role: `search_document` for `buildIndex`, `search_query` for the query. The corpus is non-PHI, but
 * a query may carry patient specifics — a documented egress tradeoff (`phi-and-secrets`); we never
 * log the texts and error PHI-free (status only).
 */

export type CohereInputType = "search_document" | "search_query";

export interface CohereEmbedOptions {
  readonly apiKey: string;
  readonly inputType: CohereInputType;
  /** Cohere embed model (default `embed-english-v3.0`). */
  readonly model?: string;
  /** Abort the call after this many ms (default 30s). */
  readonly timeoutMs?: number;
  /** Injected for tests; defaults to global `fetch`. */
  readonly fetchFn?: typeof fetch;
}

const DEFAULT_MODEL = "embed-english-v3.0";
const DEFAULT_TIMEOUT_MS = 30_000;
const EMBED_URL = "https://api.cohere.com/v2/embed";

const EmbedResponse = z.object({
  embeddings: z.object({
    float: z.array(z.array(z.number())),
  }),
});

export function createCohereEmbed(options: CohereEmbedOptions): EmbedFn {
  const fetchFn = options.fetchFn ?? fetch;
  const model = options.model ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (texts) => {
    if (texts.length === 0) {
      return [];
    }
    const response = await fetchFn(EMBED_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        input_type: options.inputType,
        embedding_types: ["float"],
        texts,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      // PHI-free: never echo the request texts (the query may carry patient specifics).
      throw new Error(`Cohere embed failed: HTTP ${response.status}`);
    }

    const parsed = EmbedResponse.parse(await response.json());
    return parsed.embeddings.float;
  };
}
