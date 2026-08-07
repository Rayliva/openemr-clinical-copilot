import { describe, it, expect } from "vitest";
import { signSessionToken, SYSTEM_INGEST_SUBJECT, type SessionTokenPayload } from "@copilot/session-token";
import { buildApp } from "../src/app.js";
import type { IngestionService } from "../src/ingestion/ingestionService.js";
import type { LabIngestionDraft, PageImage } from "@copilot/ingestion";

const BRIDGE_SECRET = "test-bridge-secret";

function tokenFor(patientFhirId: string, overrides: Partial<SessionTokenPayload> = {}): string {
  const payload: SessionTokenPayload = {
    userId: 6,
    pid: 1,
    patientFhirId,
    correlationId: "corr",
    exp: 9_999_999_999,
    ...overrides,
  };
  return signSessionToken(payload, BRIDGE_SECRET);
}

const page: PageImage = { page: 1, mediaType: "image/png", base64: "PNGDATA" };

const okDraft: LabIngestionDraft = {
  status: "ok",
  documentId: "doc-1",
  title: "susan-lab-panel.pdf",
  date: "2026-07-11",
  pages: [page],
  results: [
    {
      result: {
        testName: "Hemoglobin A1c",
        value: "8.1",
        unit: "%",
        abnormalFlag: "high",
        confidence: 0.99,
        citation: {
          sourceType: "lab_pdf",
          sourceId: "doc-1",
          pageOrSection: "page 1",
          fieldOrChunkId: "a1c",
          quoteOrValue: "8.1",
          locator: { page: 1, x: 0.4, y: 0.25, w: 0.04, h: 0.01 },
        },
      },
      match: { state: "located", boxConfidence: 1 },
    },
  ],
};

const degradedDraft: LabIngestionDraft = {
  status: "degraded",
  documentId: "doc-2",
  title: "unreadable.pdf",
  pages: [page],
  issues: ["results.0.value: required"],
};

function build(service: IngestionService, calledWith: string[] = []) {
  const wrapped: IngestionService = {
    detectAndIngest: (fhirId) => {
      calledWith.push(fhirId);
      return service.detectAndIngest(fhirId);
    },
    status: (fhirId) => service.status(fhirId),
  };
  return buildApp({ logger: false, ingestionService: wrapped, bridgeSecret: BRIDGE_SECRET });
}

const stub = (drafts: LabIngestionDraft[]): IngestionService => ({
  detectAndIngest: async () => drafts,
  status: async () => ({ total: drafts.length, ready: drafts.length, extracting: 0 }),
});

describe("POST /documents/pending", () => {
  it("401s without a bearer token (never runs ingestion)", async () => {
    const app = build(stub([okDraft]));
    const res = await app.inject({ method: "POST", url: "/documents/pending", payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("401s on an invalid token", async () => {
    const app = build(stub([okDraft]));
    const res = await app.inject({
      method: "POST",
      url: "/documents/pending",
      headers: { authorization: "Bearer not-a-real-token" },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("ingests for the token's bound patient and maps drafts (values + boxes + page image)", async () => {
    const calledWith: string[] = [];
    const app = build(stub([okDraft]), calledWith);
    const res = await app.inject({
      method: "POST",
      url: "/documents/pending",
      headers: { authorization: `Bearer ${tokenFor("susan-fhir")}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    // The patient came from the token, never the request body.
    expect(calledWith).toEqual(["susan-fhir"]);
    const body = res.json() as { documents: Array<Record<string, unknown>> };
    expect(body.documents).toHaveLength(1);
    const doc = body.documents[0]!;
    expect(doc).toMatchObject({ documentId: "doc-1", title: "susan-lab-panel.pdf", status: "ok", pageImageBase64: "PNGDATA" });
    const results = doc["results"] as Array<Record<string, unknown>>;
    expect(results[0]).toMatchObject({ testName: "Hemoglobin A1c", value: "8.1", abnormalFlag: "high", confidence: 0.99, matchState: "located" });
    expect(results[0]!["box"]).toMatchObject({ page: 1, x: 0.4 });
  });

  it("maps a degraded draft to issues, no results", async () => {
    const app = build(stub([degradedDraft]));
    const res = await app.inject({
      method: "POST",
      url: "/documents/pending",
      headers: { authorization: `Bearer ${tokenFor("f")}` },
      payload: {},
    });
    const doc = (res.json() as { documents: Array<Record<string, unknown>> }).documents[0]!;
    expect(doc["status"]).toBe("degraded");
    expect(doc["issues"]).toEqual(["results.0.value: required"]);
    expect(doc["results"]).toBeUndefined();
  });

  it("GET /documents/status returns the detect-only counts for the bound patient", async () => {
    const calledWith: string[] = [];
    const svc: IngestionService = {
      detectAndIngest: async () => [],
      status: async (fhirId) => {
        calledWith.push(fhirId);
        return { total: 3, ready: 1, extracting: 1 };
      },
    };
    const app = buildApp({ logger: false, ingestionService: svc, bridgeSecret: BRIDGE_SECRET });
    const res = await app.inject({
      method: "GET",
      url: "/documents/status",
      headers: { authorization: `Bearer ${tokenFor("susan-fhir")}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ total: 3, ready: 1, extracting: 1 });
    expect(calledWith).toEqual(["susan-fhir"]);
  });

  it("GET /documents/status 401s without a token", async () => {
    const app = build(stub([okDraft]));
    const res = await app.inject({ method: "GET", url: "/documents/status" });
    expect(res.statusCode).toBe(401);
  });

  it("POST /documents/extract accepts a system:ingest token, 202s, and triggers extraction", async () => {
    const calledWith: string[] = [];
    const app = build(stub([okDraft]), calledWith);
    const res = await app.inject({
      method: "POST",
      url: "/documents/extract",
      headers: { authorization: `Bearer ${tokenFor("susan-fhir", { subject: SYSTEM_INGEST_SUBJECT })}` },
      payload: {},
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: "accepted" });
    // extraction was kicked off in the background for the token's patient
    await new Promise((r) => setTimeout(r, 0));
    expect(calledWith).toEqual(["susan-fhir"]);
  });

  it("POST /documents/extract rejects a normal user token (403)", async () => {
    const app = build(stub([okDraft]));
    const res = await app.inject({
      method: "POST",
      url: "/documents/extract",
      headers: { authorization: `Bearer ${tokenFor("f")}` }, // no subject = user token
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it("a system:ingest token is refused on the read routes (/pending, /status)", async () => {
    const app = build(stub([okDraft]));
    const sysAuth = { authorization: `Bearer ${tokenFor("f", { subject: SYSTEM_INGEST_SUBJECT })}` };
    const pending = await app.inject({ method: "POST", url: "/documents/pending", headers: sysAuth, payload: {} });
    const status = await app.inject({ method: "GET", url: "/documents/status", headers: sysAuth });
    expect(pending.statusCode).toBe(403);
    expect(status.statusCode).toBe(403);
  });

  it("502s (generic message) when ingestion throws — no internals leaked", async () => {
    const app = build({ detectAndIngest: async () => { throw new Error("BinaryFetch 500 at https://internal"); } });
    const res = await app.inject({
      method: "POST",
      url: "/documents/pending",
      headers: { authorization: `Bearer ${tokenFor("f")}` },
      payload: {},
    });
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain("internal");
    expect((res.json() as { error: string }).error).toBe("document ingestion failed");
  });
});
