import type { LabIngestionDraft } from "@copilot/ingestion";

/**
 * Redis-backed cache for pending-review ingestion drafts + a per-document in-flight lock, so a
 * document is extracted **once** (the paid VLM call) and the review modal opens instantly on a cache
 * hit. The cache holds PHI (page image + extracted values) — it lives only in the agent's own,
 * in-boundary Redis, is TTL-bounded (minimum-necessary PHI-at-rest, `phi-and-secrets`), and is never
 * serialized into a log. The lock lets a concurrent trigger + modal **coalesce** onto one extraction
 * instead of double-running it.
 */

/**
 * The Redis operations this cache needs, as semantic methods (so the ioredis-overload noise stays at
 * the edge adapter and tests can inject a trivial fake).
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  /** SET key value EX ttl. */
  setWithTtl(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** SET key value EX ttl NX — returns true iff the key was previously unset (lock acquired). */
  setNxWithTtl(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  del(key: string): Promise<void>;
}

/** Detect-only status for the notification dot (cached per pid to avoid hammering OpenEMR). */
export interface IngestionStatus {
  readonly total: number;
  readonly ready: number;
  readonly extracting: number;
  /**
   * The detected documents' FHIR ids. The chart widget subtracts the physician's already-reviewed
   * documents from these to decide whether to show the "Review Documents" launcher (W2 workflow).
   * Optional so older cached statuses (pre-field) and test stubs remain valid.
   */
  readonly documentIds?: readonly string[];
}

/**
 * The extraction result WITHOUT the page image — the expensive VLM + OCR output. Persisted longer than
 * the full draft so the PAID VLM runs once ever; the large image is regenerated (re-rasterized) on
 * demand, so the big PHI blob is not kept at rest (only the small results are). Distributes the
 * page-strip over the draft's ok/degraded union so the `status` discriminant is preserved.
 */
type StripPages<T> = T extends unknown ? Omit<T, "pages"> : never;
export type PersistedExtraction = StripPages<LabIngestionDraft>;

export interface DraftCache {
  get(documentId: string): Promise<LabIngestionDraft | null>;
  set(documentId: string, draft: LabIngestionDraft): Promise<void>;
  /**
   * The persisted extraction result (no image) for a VLM-free re-open, or null. When present, the
   * caller re-rasterizes the page image and reattaches it instead of re-running the VLM.
   */
  getExtraction(documentId: string): Promise<PersistedExtraction | null>;
  setExtraction(documentId: string, extraction: PersistedExtraction): Promise<void>;
  /** Atomically claim the extraction lock; true if acquired, false if another extraction holds it. */
  acquireLock(documentId: string): Promise<boolean>;
  releaseLock(documentId: string): Promise<void>;
  isLocked(documentId: string): Promise<boolean>;
  /** A short-TTL per-pid status cache so repeated dot polls don't re-hit the (audited) FHIR search. */
  getStatus(patientFhirId: string): Promise<IngestionStatus | null>;
  setStatus(patientFhirId: string, status: IngestionStatus): Promise<void>;
}

export interface DraftCacheOptions {
  /** Full-draft TTL in seconds (incl. the page image) — hours (minimum-necessary PHI-at-rest). */
  readonly ttlSeconds: number;
  /**
   * Extraction-result TTL in seconds (default 30 days) — the paid VLM+OCR output WITHOUT the image,
   * kept for the review lifecycle so re-opens skip the VLM. Small + in-boundary.
   */
  readonly extractionTtlSeconds?: number;
  /** Lock TTL in seconds — long enough for one extraction, short enough to self-heal a crash. */
  readonly lockTtlSeconds?: number;
  /** Per-pid status-cache TTL in seconds (default 10) — a fresh-enough dot without polling OpenEMR. */
  readonly statusTtlSeconds?: number;
}

const DRAFT_PREFIX = "copilot:ingest:draft:";
const EXTRACTION_PREFIX = "copilot:ingest:extraction:";
const LOCK_PREFIX = "copilot:ingest:lock:";
const STATUS_PREFIX = "copilot:ingest:status:";
const DEFAULT_LOCK_TTL = 120;
const DEFAULT_STATUS_TTL = 10;
const DEFAULT_EXTRACTION_TTL = 30 * 24 * 60 * 60; // 30 days — the review lifecycle

export function createRedisDraftCache(redis: RedisLike, options: DraftCacheOptions): DraftCache {
  const ttl = options.ttlSeconds;
  const lockTtl = options.lockTtlSeconds ?? DEFAULT_LOCK_TTL;
  const statusTtl = options.statusTtlSeconds ?? DEFAULT_STATUS_TTL;
  const extractionTtl = options.extractionTtlSeconds ?? DEFAULT_EXTRACTION_TTL;

  return {
    async get(documentId) {
      const raw = await redis.get(DRAFT_PREFIX + documentId);
      if (raw === null) {
        return null;
      }
      try {
        return JSON.parse(raw) as LabIngestionDraft;
      } catch {
        // A corrupt cached value is a cache miss, never a thrown request — re-extract on demand.
        return null;
      }
    },

    async set(documentId, draft) {
      await redis.setWithTtl(DRAFT_PREFIX + documentId, JSON.stringify(draft), ttl);
    },

    async getExtraction(documentId) {
      const raw = await redis.get(EXTRACTION_PREFIX + documentId);
      if (raw === null) {
        return null;
      }
      try {
        return JSON.parse(raw) as PersistedExtraction;
      } catch {
        return null; // corrupt → treat as absent → full re-extract
      }
    },

    async setExtraction(documentId, extraction) {
      await redis.setWithTtl(EXTRACTION_PREFIX + documentId, JSON.stringify(extraction), extractionTtl);
    },

    async acquireLock(documentId) {
      // Atomic claim (SET NX EX) — true only if the lock key was previously unset.
      return redis.setNxWithTtl(LOCK_PREFIX + documentId, "1", lockTtl);
    },

    async releaseLock(documentId) {
      await redis.del(LOCK_PREFIX + documentId);
    },

    async isLocked(documentId) {
      return (await redis.get(LOCK_PREFIX + documentId)) !== null;
    },

    async getStatus(patientFhirId) {
      const raw = await redis.get(STATUS_PREFIX + patientFhirId);
      if (raw === null) {
        return null;
      }
      try {
        return JSON.parse(raw) as IngestionStatus;
      } catch {
        return null;
      }
    },

    async setStatus(patientFhirId, status) {
      await redis.setWithTtl(STATUS_PREFIX + patientFhirId, JSON.stringify(status), statusTtl);
    },
  };
}
