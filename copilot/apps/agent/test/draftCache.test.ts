import { describe, it, expect } from "vitest";
import type { LabIngestionDraft } from "@copilot/ingestion";
import { createRedisDraftCache, type RedisLike } from "../src/ingestion/draftCache.js";

/** A tiny in-memory RedisLike double recording TTLs and honoring SET NX semantics. */
function fakeRedis(): RedisLike & { store: Map<string, string>; ttls: Map<string, number> } {
  const store = new Map<string, string>();
  const ttls = new Map<string, number>();
  return {
    store,
    ttls,
    async get(key) {
      return store.get(key) ?? null;
    },
    async setWithTtl(key, value, ttlSeconds) {
      store.set(key, value);
      ttls.set(key, ttlSeconds);
    },
    async setNxWithTtl(key, value, ttlSeconds) {
      if (store.has(key)) {
        return false;
      }
      store.set(key, value);
      ttls.set(key, ttlSeconds);
      return true;
    },
    async del(key) {
      store.delete(key);
    },
  };
}

const draft: LabIngestionDraft = {
  status: "ok",
  documentId: "doc-1",
  title: "susan-lab-panel.pdf",
  pages: [{ page: 1, mediaType: "image/png", base64: "IMG" }],
  results: [],
};

describe("createRedisDraftCache", () => {
  it("round-trips a draft with a bounded TTL", async () => {
    const redis = fakeRedis();
    const cache = createRedisDraftCache(redis, { ttlSeconds: 3600 });
    expect(await cache.get("doc-1")).toBeNull();
    await cache.set("doc-1", draft);
    expect(await cache.get("doc-1")).toMatchObject({ documentId: "doc-1", status: "ok" });
    // the draft key carries the configured TTL (minimum-necessary PHI-at-rest)
    const key = [...redis.ttls.keys()].find((k) => k.includes("draft"));
    expect(key).toBeDefined();
    expect(redis.ttls.get(key!)).toBe(3600);
  });

  it("returns null (not a throw) on a corrupt cached value", async () => {
    const redis = fakeRedis();
    redis.store.set("copilot:ingest:draft:doc-x", "{not json");
    const cache = createRedisDraftCache(redis, { ttlSeconds: 3600 });
    expect(await cache.get("doc-x")).toBeNull();
  });

  it("acquireLock is atomic (SET NX): second caller does not get the lock", async () => {
    const cache = createRedisDraftCache(fakeRedis(), { ttlSeconds: 3600 });
    expect(await cache.acquireLock("doc-1")).toBe(true);
    expect(await cache.acquireLock("doc-1")).toBe(false);
    expect(await cache.isLocked("doc-1")).toBe(true);
    await cache.releaseLock("doc-1");
    expect(await cache.isLocked("doc-1")).toBe(false);
    expect(await cache.acquireLock("doc-1")).toBe(true);
  });
});
