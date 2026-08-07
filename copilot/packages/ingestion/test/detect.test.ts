import { describe, it, expect } from "vitest";
import { detectPendingDocuments, type PendingDocument } from "../src/detect.js";

/** A DocumentReference resource in OpenEMR's FHIR shape (content.attachment.url → Binary/<id>). */
function docRef(over: {
  id: string;
  status?: string;
  contentType?: string;
  binaryId?: string | null;
  title?: string;
  date?: string;
}): unknown {
  const attachment: Record<string, unknown> = {
    contentType: over.contentType ?? "application/pdf",
    title: over.title ?? "Lab report",
  };
  if (over.binaryId !== null) {
    attachment["url"] = `https://host/apis/default/fhir/Binary/${over.binaryId ?? over.id}`;
  }
  return {
    resource: {
      resourceType: "DocumentReference",
      id: over.id,
      status: over.status ?? "current",
      date: over.date ?? "2026-07-11T00:00:00Z",
      content: [{ attachment }],
    },
  };
}

function bundle(...entries: unknown[]): unknown {
  return { resourceType: "Bundle", type: "searchset", entry: entries };
}

describe("detectPendingDocuments", () => {
  it("returns a PendingDocument for a current, unprocessed PDF with the Binary id parsed", () => {
    const out = detectPendingDocuments(bundle(docRef({ id: "doc-1", binaryId: "bin-1" })), new Set());
    expect(out).toHaveLength(1);
    const doc = out[0] as PendingDocument;
    expect(doc).toMatchObject({
      documentId: "doc-1",
      binaryId: "bin-1",
      contentType: "application/pdf",
      title: "Lab report",
      date: "2026-07-11T00:00:00Z",
    });
  });

  it("excludes a document whose id is already processed", () => {
    const out = detectPendingDocuments(bundle(docRef({ id: "doc-1" })), new Set(["doc-1"]));
    expect(out).toEqual([]);
  });

  it("excludes an unsupported content type", () => {
    const out = detectPendingDocuments(
      bundle(docRef({ id: "d", contentType: "text/plain" }), docRef({ id: "d2", contentType: "image/tiff" })),
      new Set(),
    );
    expect(out).toEqual([]);
  });

  it("excludes superseded and entered-in-error statuses", () => {
    const out = detectPendingDocuments(
      bundle(docRef({ id: "a", status: "superseded" }), docRef({ id: "b", status: "entered-in-error" })),
      new Set(),
    );
    expect(out).toEqual([]);
  });

  it("excludes an attachment with no Binary url (can't be fetched)", () => {
    const out = detectPendingDocuments(bundle(docRef({ id: "d", binaryId: null })), new Set());
    expect(out).toEqual([]);
  });

  it("returns [] for an empty bundle (no entry)", () => {
    expect(detectPendingDocuments({ resourceType: "Bundle", type: "searchset" }, new Set())).toEqual([]);
  });

  it("skips a malformed entry without dropping the valid ones", () => {
    const out = detectPendingDocuments(
      bundle({ resource: { resourceType: "DocumentReference" } }, docRef({ id: "ok" })),
      new Set(),
    );
    expect(out.map((d) => d.documentId)).toEqual(["ok"]);
  });

  it("throws on a non-object bundle (a corrupt response fails loud)", () => {
    expect(() => detectPendingDocuments(null, new Set())).toThrow();
    expect(() => detectPendingDocuments("nope", new Set())).toThrow();
  });

  it("skips a non-object entry without dropping valid siblings", () => {
    const out = detectPendingDocuments(bundle(null, 42, docRef({ id: "ok" })), new Set());
    expect(out.map((d) => d.documentId)).toEqual(["ok"]);
  });

  it("picks a later supported attachment when an earlier one is unusable", () => {
    const resource = {
      resourceType: "DocumentReference",
      id: "multi",
      status: "current",
      content: [
        { attachment: { contentType: "text/plain", url: "https://host/fhir/Binary/txt" } },
        { attachment: { contentType: "application/pdf" } }, // no url
        { attachment: { contentType: "application/pdf", url: "https://host/fhir/Binary/pdf-2", title: "T" } },
      ],
    };
    const out = detectPendingDocuments({ resourceType: "Bundle", entry: [{ resource }] }, new Set());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ documentId: "multi", binaryId: "pdf-2", title: "T" });
  });

  it("excludes a DocumentReference with no status (status is required; conservative exclude)", () => {
    const resource = {
      resourceType: "DocumentReference",
      id: "no-status",
      content: [{ attachment: { contentType: "application/pdf", url: "https://host/fhir/Binary/b" } }],
    };
    expect(detectPendingDocuments({ resourceType: "Bundle", entry: [{ resource }] }, new Set())).toEqual([]);
  });

  it("omits date when the DocumentReference has none, and tolerates a parameterized content type + query-string url", () => {
    const resource = {
      resourceType: "DocumentReference",
      id: "d",
      status: "current",
      content: [
        { attachment: { contentType: "application/pdf; charset=binary", url: "https://host/fhir/Binary/b?_format=json" } },
      ],
    };
    const out = detectPendingDocuments({ resourceType: "Bundle", entry: [{ resource }] }, new Set());
    expect(out).toHaveLength(1);
    expect(out[0]?.binaryId).toBe("b");
    expect("date" in (out[0] as object)).toBe(false);
  });
});
