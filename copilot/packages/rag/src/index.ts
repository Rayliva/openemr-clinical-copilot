export { GuidelineChunk, EvidenceSnippet } from "./contracts.js";
export { chunkMarkdown, type MarkdownDoc, type ChunkOptions } from "./chunk.js";
export { expandQuery } from "./expand.js";
export { fuseRRF, type RankedItem, type FusedItem, type FuseOptions } from "./fuse.js";
export {
  cosineSimilarity,
  bagOfWordsEmbed,
  buildIndex,
  retrieveEvidence,
  type EmbedFn,
  type EmbeddedChunk,
  type RetrieveOptions,
} from "./retrieve.js";
export {
  rerankEvidence,
  type RerankFn,
  type RerankResult,
  type RerankOptions,
} from "./rerank.js";
