import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { AgentDeps } from "../src/graph/types.js";
import type { IngestionService } from "../src/ingestion/ingestionService.js";
import type { MetricsRegistry } from "@copilot/metrics";

/**
 * Contract test for `apps/agent/openapi.json`.
 *
 * Guarantees:
 *  1. The file is a structurally valid OpenAPI 3.0.x document.
 *  2. The set of documented `path` + method operations is a SUPERSET of the routes
 *     ACTUALLY registered by `src/app.ts` — so adding a route without documenting it fails
 *     this test.
 *  3. No documented operation is a phantom (every documented method+path is a real route).
 *
 * Enumeration strategy: the registered-route set is read from `app.routeManifest` — populated
 * at `ready()` by an `onRoute` hook in `buildApp` — so it reflects the routes truly mounted,
 * not a hand-maintained list (which drifts silently: that is how `/labs/series` slipped through
 * undocumented while the old explicit table stayed green). The app is built with EVERY
 * conditional dependency stubbed so all fail-closed routes register, giving full coverage.
 */

const openapiPath = fileURLToPath(new URL("../openapi.json", import.meta.url));
const spec = JSON.parse(readFileSync(openapiPath, "utf8")) as {
  openapi: string;
  info?: { title?: string; version?: string };
  paths: Record<string, Record<string, unknown>>;
  components?: { securitySchemes?: Record<string, unknown> };
};

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head"]);

/**
 * Build the app with every conditional dependency present (stubbed) so all fail-closed routes
 * register. buildApp only checks each dependency for presence at registration time — it never
 * invokes them — so opaque stubs are sufficient to enumerate the route surface.
 */
function buildFullApp(): FastifyInstance {
  return buildApp({
    logger: false,
    bridgeSecret: "contract-test-secret",
    agent: {} as unknown as AgentDeps,
    ingestionService: {} as unknown as IngestionService,
    labSeriesReader: async () => ({ documented: false }),
    metrics: {} as unknown as MetricsRegistry,
    metricsToken: "contract-test-ops-token",
    devMint: true,
  });
}

/**
 * The routes actually registered, as `METHOD path`. Sourced from `app.routeManifest`; the
 * auto-generated `HEAD` companion of each `GET` is dropped (the spec documents no HEAD ops).
 */
function registeredRoutes(app: FastifyInstance): Set<string> {
  const routes = new Set<string>();
  for (const entry of app.routeManifest) {
    if (!entry.startsWith("HEAD ")) {
      routes.add(entry);
    }
  }
  return routes;
}

/** Flatten the OpenAPI paths object into a `METHOD path` set. */
function documentedOperations(): Set<string> {
  const ops = new Set<string>();
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of Object.keys(item)) {
      if (HTTP_METHODS.has(method.toLowerCase())) {
        ops.add(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  return ops;
}

describe("openapi.json — structure", () => {
  it("declares OpenAPI 3.0.x", () => {
    expect(spec.openapi).toMatch(/^3\.0\.\d+$/);
  });

  it("has info.title and info.version", () => {
    expect(spec.info?.title).toBeTypeOf("string");
    expect(spec.info?.title?.length ?? 0).toBeGreaterThan(0);
    expect(spec.info?.version).toBeTypeOf("string");
  });

  it("has a non-empty paths object", () => {
    expect(spec.paths).toBeTypeOf("object");
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
  });

  it("every operation declares at least one response", () => {
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(item)) {
        if (!HTTP_METHODS.has(method.toLowerCase())) {
          continue;
        }
        const responses = (op as { responses?: Record<string, unknown> }).responses;
        expect(responses, `${method} ${path} must declare responses`).toBeTypeOf("object");
        expect(Object.keys(responses ?? {}).length, `${method} ${path} responses`).toBeGreaterThan(0);
      }
    }
  });

  it("references only resolvable local $refs", () => {
    const json = JSON.stringify(spec);
    const refs = [...json.matchAll(/"\$ref":"(#[^"]+)"/g)].map((m) => m[1]);
    for (const ref of refs) {
      const segments = ref.slice(2).split("/"); // strip leading "#/"
      let node: unknown = spec;
      for (const seg of segments) {
        expect(node, `unresolvable $ref ${ref} at segment ${seg}`).toBeTypeOf("object");
        node = (node as Record<string, unknown>)[seg];
      }
      expect(node, `unresolvable $ref ${ref}`).toBeDefined();
    }
  });
});

describe("openapi.json — route coverage (introspected from app.routeManifest)", () => {
  const documented = documentedOperations();
  let app: FastifyInstance;
  let registered: Set<string>;

  beforeAll(async () => {
    app = buildFullApp();
    await app.ready(); // onRoute fires during ready() — the manifest is complete afterwards
    registered = registeredRoutes(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("registers a non-trivial route surface (the manifest is actually populated)", () => {
    // Guards against the introspection silently returning empty and making the checks vacuous.
    expect(registered.size).toBeGreaterThanOrEqual(10);
    expect(registered.has("POST /labs/series")).toBe(true); // the route that slipped through before
  });

  it("documents a SUPERSET of every registered route", () => {
    const missing = [...registered].filter((r) => !documented.has(r)).sort();
    expect(missing, `routes registered in app.ts but not documented: ${missing.join(", ")}`).toEqual([]);
  });

  it("documents no phantom operations (every documented op is a registered route)", () => {
    const phantom = [...documented].filter((op) => !registered.has(op)).sort();
    expect(phantom, `documented but not registered in app.ts: ${phantom.join(", ")}`).toEqual([]);
  });

  it("defines the bearer security schemes the spec references", () => {
    const schemes = spec.components?.securitySchemes ?? {};
    for (const name of ["SessionBearer", "SystemIngestBearer", "OpsBearer"]) {
      expect(schemes[name], `missing securityScheme ${name}`).toBeDefined();
    }
  });
});

describe("openapi.json — fail-closed routes are gated on their deps", () => {
  it("without deps, a conditional route is not registered (404) but always-on routes respond", async () => {
    const app = buildApp({ logger: false });
    try {
      const health = await app.inject({ method: "GET", url: "/health" });
      expect(health.statusCode).toBe(200);
      const ready = await app.inject({ method: "GET", url: "/ready" });
      expect([200, 503]).toContain(ready.statusCode);
      const root = await app.inject({ method: "GET", url: "/" });
      expect(root.statusCode).toBe(200);
      // A conditional route is NOT registered without its deps (fail-closed) -> 404.
      const chat = await app.inject({ method: "POST", url: "/chat", payload: {} });
      expect(chat.statusCode).toBe(404);
      const labs = await app.inject({ method: "POST", url: "/labs/series", payload: {} });
      expect(labs.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
