import type { GuidelineChunk, EvidenceSnippet } from "./contracts.js";
import { fuseRRF, type RankedItem } from "./fuse.js";
import { expandQuery } from "./expand.js";

/**
 * Pure hybrid retrieval: dense (cosine over embeddings) + keyword (exact term overlap) search,
 * composed via RRF into cited `EvidenceSnippet`s. The embedder is INJECTED (`EmbedFn`) — a
 * deterministic bag-of-words embedder for offline/CI, the real Cohere embed v3 in prod. The
 * in-memory index is the test/small-corpus store; a pgvector store implements the same idea for
 * prod. Empty retrieval → `[]` — never a fabricated citation (`w2-hybrid-rag`).
 */

/** Batch text embedder. Prod = Cohere embed v3; offline/CI = {@link bagOfWordsEmbed}. */
export type EmbedFn = (texts: readonly string[]) => Promise<number[][]>;

export interface EmbeddedChunk {
  readonly chunk: GuidelineChunk;
  readonly embedding: readonly number[];
}

export interface RetrieveOptions {
  /** Max snippets returned (default 5). */
  readonly topK?: number;
  /** RRF constant passed to fusion (default 60). */
  readonly kRRF?: number;
}

const DEFAULT_TOP_K = 5;
const EMBED_DIM = 256;

/** Cosine similarity; returns 0 (not NaN) when either vector is all-zero. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function hashTerm(term: string): number {
  let h = 0;
  for (let i = 0; i < term.length; i += 1) {
    h = (h * 31 + term.charCodeAt(i)) >>> 0;
  }
  return h % EMBED_DIM;
}

/**
 * A deterministic, offline bag-of-words embedder: hash each token into a fixed-dim term-count
 * vector. Cosine over these reflects term overlap — enough for offline/CI retrieval and tests
 * without a live Cohere call. Not for production quality (paraphrase/semantics); the Cohere
 * adapter replaces it there.
 */
export const bagOfWordsEmbed: EmbedFn = async (texts) =>
  texts.map((text) => {
    const vec = new Array<number>(EMBED_DIM).fill(0);
    for (const token of tokenize(text)) {
      const dim = hashTerm(token);
      vec[dim] = (vec[dim] ?? 0) + 1;
    }
    return vec;
  });

/** Embed every chunk's text into an in-memory index. */
export async function buildIndex(
  chunks: readonly GuidelineChunk[],
  embed: EmbedFn,
): Promise<EmbeddedChunk[]> {
  const embeddings = await embed(chunks.map((c) => c.text));
  return chunks.map((chunk, i) => ({ chunk, embedding: embeddings[i] ?? [] }));
}

/** Dense search: rank chunks by cosine to the query embedding, tie-broken by chunkId. */
function denseSearch(queryEmbedding: readonly number[], index: readonly EmbeddedChunk[], k: number): RankedItem[] {
  return index
    .map((ec) => ({ chunkId: ec.chunk.chunkId, sim: cosineSimilarity(queryEmbedding, ec.embedding) }))
    .sort((a, b) => b.sim - a.sim || a.chunkId.localeCompare(b.chunkId))
    .slice(0, k)
    .map((x) => ({ chunkId: x.chunkId }));
}

/** Keyword search: score by exact query-term overlap; only chunks with a match are returned. */
function keywordSearch(query: string, index: readonly EmbeddedChunk[], k: number): RankedItem[] {
  const queryTerms = new Set(tokenize(query));
  return index
    .map((ec) => {
      let score = 0;
      for (const term of tokenize(ec.chunk.text)) {
        if (queryTerms.has(term)) {
          score += 1;
        }
      }
      return { chunkId: ec.chunk.chunkId, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId))
    .slice(0, k)
    .map((x) => ({ chunkId: x.chunkId }));
}

/**
 * Retrieve the top guideline snippets for a query: embed the query, run dense + keyword search,
 * fuse via RRF, and map the fused top-K back to cited `EvidenceSnippet`s. Deterministic.
 */
export async function retrieveEvidence(
  query: string,
  index: readonly EmbeddedChunk[],
  embed: EmbedFn,
  options: RetrieveOptions = {},
): Promise<EvidenceSnippet[]> {
  if (index.length === 0) {
    return [];
  }
  const topK = options.topK ?? DEFAULT_TOP_K;
  const pool = Math.max(topK, 10); // fuse a wider pool than we return
  const queryEmbedding = (await embed([query]))[0] ?? [];

  const dense = denseSearch(queryEmbedding, index, pool);
  // Keyword arm searches the CLINICALLY-EXPANDED query (abbreviations → canonical guideline terms),
  // so a physician's shorthand ("a1c", "htn") matches the prose ("hemoglobin A1c", "hypertension").
  // The dense arm keeps the original query — embedding a synonym blob would dilute the vector, and
  // dense already captures paraphrase (`w2-contextual-retrieval`).
  const keyword = keywordSearch(expandQuery(query), index, pool);
  const fused = fuseRRF([dense, keyword], options.kRRF !== undefined ? { k: options.kRRF } : {});

  const chunkById = new Map(index.map((ec) => [ec.chunk.chunkId, ec.chunk]));
  const snippets: EvidenceSnippet[] = [];
  for (const item of fused.slice(0, topK)) {
    const chunk = chunkById.get(item.chunkId);
    if (chunk !== undefined) {
      snippets.push({ ...chunk, score: item.score });
    }
  }
  return snippets;
}
