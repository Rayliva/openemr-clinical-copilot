import { describe, it, expect } from "vitest";
import { createMetricsRegistry } from "@copilot/metrics";
import type { LabIngestionDeps, LabIngestionDraft, PageImage } from "@copilot/ingestion";
import { runDetectAndIngest, statusOf } from "../src/ingestion/ingestionService.js";
import type { DraftCache } from "../src/ingestion/draftCache.js";

const page: PageImage = { page: 1, mediaType: "image/png", base64: "IMG" };

/** A schema-valid lab result whose `value` the OCR either does or does not contain. */
function labResult(value: string): unknown {
  return {
    testName: "Glucose",
    value,
    abnormalFlag: "normal",
    confidence: 0.9,
    citation: {
      sourceType: "lab_pdf",
      sourceId: "doc",
      pageOrSection: "page 1",
      fieldOrChunkId: "Glucose",
      quoteOrValue: value,
    },
  };
}

/** Deps whose VLM returns the given results; OCR contains only the word "150" (so "150" → located). */
function depsWithResults(results: readonly unknown[]): LabIngestionDeps {
  return {
    fetchBinary: async () => new Uint8Array([1]),
    rasterize: async () => [page],
    vlm: async () => ({ docType: "lab_pdf", results }),
    ocr: async () => ({ words: [{ text: "150", box: { page: 1, x: 0.1, y: 0.1, w: 0.1, h: 0.05 } }] }),
  };
}

/** An in-memory DraftCache double. */
function fakeCache(): DraftCache & {
  drafts: Map<string, LabIngestionDraft>;
  locks: Set<string>;
  extractions: Map<string, import("../src/ingestion/draftCache.js").PersistedExtraction>;
} {
  const drafts = new Map<string, LabIngestionDraft>();
  const locks = new Set<string>();
  const extractions = new Map<string, import("../src/ingestion/draftCache.js").PersistedExtraction>();
  const statuses = new Map<string, import("../src/ingestion/draftCache.js").IngestionStatus>();
  return {
    drafts,
    locks,
    extractions,
    async get(id) {
      return drafts.get(id) ?? null;
    },
    async set(id, d) {
      drafts.set(id, d);
    },
    async getExtraction(id) {
      return extractions.get(id) ?? null;
    },
    async setExtraction(id, e) {
      extractions.set(id, e);
    },
    async acquireLock(id) {
      if (locks.has(id)) return false;
      locks.add(id);
      return true;
    },
    async releaseLock(id) {
      locks.delete(id);
    },
    async isLocked(id) {
      return locks.has(id);
    },
    async getStatus(pid) {
      return statuses.get(pid) ?? null;
    },
    async setStatus(pid, s) {
      statuses.set(pid, s);
    },
  };
}

/** Counts how many times the VLM actually ran (extract-once proof). */
function countingDeps(counter: { n: number; raster?: number }): LabIngestionDeps {
  return {
    fetchBinary: async () => new Uint8Array([1]),
    rasterize: async () => {
      counter.raster = (counter.raster ?? 0) + 1;
      return [page];
    },
    vlm: async () => {
      counter.n += 1;
      return { docType: "lab_pdf", results: [] };
    },
    ocr: async () => ({ words: [] }),
  };
}

function bundle(ids: string[]): unknown {
  return {
    resourceType: "Bundle",
    entry: ids.map((id) => ({
      resource: {
        resourceType: "DocumentReference",
        id,
        status: "current",
        content: [{ attachment: { contentType: "application/pdf", url: `https://h/fhir/Binary/${id}` } }],
      },
    })),
  };
}

const fhir = (ids: string[]) => ({
  search: async () => bundle(ids),
  readBinary: async () => new Uint8Array([1]),
});

describe("runDetectAndIngest (cache-aware)", () => {
  it("extracts + caches each detected doc, scoped to the bound patient", async () => {
    const counter = { n: 0 };
    const cache = fakeCache();
    const drafts = await runDetectAndIngest(fhir(["a", "b"]), countingDeps(counter), cache, "susan-fhir");
    expect(drafts.map((d) => d.documentId)).toEqual(["a", "b"]);
    expect(counter.n).toBe(2);
    expect(cache.drafts.size).toBe(2);
    expect([...cache.locks]).toEqual([]); // locks released
  });

  it("serves a cached draft without re-running the VLM (extract-once)", async () => {
    const counter = { n: 0 };
    const cache = fakeCache();
    await runDetectAndIngest(fhir(["a"]), countingDeps(counter), cache, "f");
    await runDetectAndIngest(fhir(["a"]), countingDeps(counter), cache, "f");
    expect(counter.n).toBe(1); // second call was a cache hit
  });

  it("re-opens VLM-free when the full draft expired but the extraction persisted (re-rasterizes only)", async () => {
    const counter = { n: 0, raster: 0 };
    const cache = fakeCache();
    await runDetectAndIngest(fhir(["a"]), countingDeps(counter), cache, "f");
    expect(counter.n).toBe(1); // VLM ran once
    expect(cache.extractions.has("a")).toBe(true); // extraction persisted
    // Simulate the short-TTL full draft (with image) expiring while the extraction survives.
    cache.drafts.clear();
    const drafts = await runDetectAndIngest(fhir(["a"]), countingDeps(counter), cache, "f");
    expect(counter.n).toBe(1); // VLM did NOT re-run — persisted extraction reused
    expect(counter.raster).toBe(2); // image was re-rasterized on demand
    expect(drafts[0]?.pages).toEqual([page]); // draft carries the regenerated image
  });

  it("extracts only the requested document ids when a filter is passed", async () => {
    const counter = { n: 0 };
    const cache = fakeCache();
    const drafts = await runDetectAndIngest(fhir(["a", "b", "c"]), countingDeps(counter), cache, "f", {}, ["b"]);
    expect(drafts.map((d) => d.documentId)).toEqual(["b"]); // only the requested doc
    expect(counter.n).toBe(1); // the other two were never extracted
  });

  it("skips a doc whose lock is already held (coalesces with an in-flight extraction)", async () => {
    const counter = { n: 0 };
    const cache = fakeCache();
    cache.locks.add("a"); // simulate a concurrent extraction in flight
    const drafts = await runDetectAndIngest(fhir(["a"]), countingDeps(counter), cache, "f");
    expect(drafts).toEqual([]);
    expect(counter.n).toBe(0); // did not double-extract
  });
});

describe("runDetectAndIngest — W2 observability", () => {
  it("records ingestion metrics per extracted doc (located vs forced-review)", async () => {
    const metrics = createMetricsRegistry();
    const cache = fakeCache();
    // "150" is on the OCR page → located; "999" is not → forced review.
    await runDetectAndIngest(
      fhir(["a"]),
      depsWithResults([labResult("150"), labResult("999")]),
      cache,
      "f",
      { metrics },
    );

    const s = metrics.snapshot();
    expect(s.ingestion.documentsTotal).toBe(1);
    expect(s.ingestion.byDocType.lab_pdf).toMatchObject({ total: 1, ok: 1, degraded: 0 });
    expect(s.ingestion.fieldsLocated).toBe(1);
    expect(s.ingestion.fieldsForcedReview).toBe(1);
    expect(s.ingestion.extractionLatencyMs.p50).not.toBeNull();
  });

  it("does not record metrics on a cache hit (extract-once)", async () => {
    const metrics = createMetricsRegistry();
    const cache = fakeCache();
    await runDetectAndIngest(fhir(["a"]), depsWithResults([labResult("150")]), cache, "f", { metrics });
    await runDetectAndIngest(fhir(["a"]), depsWithResults([labResult("150")]), cache, "f", { metrics });
    expect(metrics.snapshot().ingestion.documentsTotal).toBe(1);
  });

  it("records a degraded extraction with no field samples", async () => {
    const metrics = createMetricsRegistry();
    const cache = fakeCache();
    const badDeps: LabIngestionDeps = { ...depsWithResults([]), vlm: async () => ({ docType: "not-a-lab" }) };
    await runDetectAndIngest(fhir(["a"]), badDeps, cache, "f", { metrics });

    const s = metrics.snapshot();
    expect(s.ingestion.extractionDegraded).toBe(1);
    expect(s.ingestion.extractionOk).toBe(0);
    expect(s.ingestion.fieldsLocated).toBe(0);
  });

  it("emits ingestion.complete + extraction.field events with the correlation id, no PHI", async () => {
    const events: { msg: string; obj: Record<string, unknown> }[] = [];
    const logger = {
      info: (obj: Record<string, unknown>, msg: string) => events.push({ msg, obj }),
      error: () => {},
    };
    const cache = fakeCache();
    await runDetectAndIngest(fhir(["a"]), depsWithResults([labResult("150")]), cache, "f", {
      logger,
      correlationId: "corr-1",
    });

    const names = events.map((e) => e.msg);
    expect(names).toContain("extraction.field");
    expect(names).toContain("ingestion.complete");
    expect(events.every((e) => e.obj.correlationId === "corr-1")).toBe(true);
    // The extraction.field event carries the numeric per-document confidence (Core Req 7), PHI-free.
    const field = events.find((e) => e.msg === "extraction.field");
    expect(typeof field?.obj.confidenceMean).toBe("number");
    expect(typeof field?.obj.confidenceMin).toBe("number");
    expect(field?.obj.fields).toBeGreaterThan(0);
    // No PHI: the document value/title never appears in a log event.
    const serialized = JSON.stringify(events).toLowerCase();
    expect(serialized).not.toContain("glucose");
  });
});

describe("statusOf (detect-only, no VLM)", () => {
  it("counts total / ready / extracting without extracting", async () => {
    const counter = { n: 0 };
    const cache = fakeCache();
    cache.drafts.set("a", { status: "ok", documentId: "a", title: "t", pages: [page], results: [] });
    cache.locks.add("b");
    const st = await statusOf(fhir(["a", "b", "c"]), cache, "f");
    expect(st).toEqual({ total: 3, ready: 1, extracting: 1, documentIds: ["a", "b", "c"] });
    expect(counter.n).toBe(0);
  });

  it("serves a repeat status from the per-pid cache without re-hitting the FHIR search", async () => {
    const cache = fakeCache();
    let searches = 0;
    const countingFhir = {
      search: async () => {
        searches += 1;
        return bundle(["a"]);
      },
      readBinary: async () => new Uint8Array([1]),
    };
    await statusOf(countingFhir, cache, "f");
    await statusOf(countingFhir, cache, "f");
    expect(searches).toBe(1); // second call was a status-cache hit
  });
});
