import { describe, it, expect, vi } from "vitest";
import { OpenEmrFhirClient } from "../src/fhir/client.js";

function fhirResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/fhir+json" },
  });
}

describe("OpenEmrFhirClient", () => {
  it("reads a resource with a bearer token and fhir+json Accept header", async () => {
    const fetchFn = vi.fn(async () => fhirResponse({ resourceType: "Patient", id: "abc" }));
    const client = new OpenEmrFhirClient({
      baseUrl: "https://oe.test",
      getAccessToken: async () => "TOKEN-1",
      fetchFn,
    });

    const res = await client.read("Patient", "abc");
    expect(res).toMatchObject({ resourceType: "Patient", id: "abc" });

    const call = fetchFn.mock.calls[0]!;
    expect(call[0]).toBe("https://oe.test/apis/default/fhir/Patient/abc");
    const headers = new Headers(call[1]!.headers);
    expect(headers.get("authorization")).toBe("Bearer TOKEN-1");
    expect(headers.get("accept")).toBe("application/fhir+json");
  });

  it("reads a Binary resource's raw bytes (not JSON)", async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]); // %PDF-1
    const fetchFn = vi.fn(
      async () => new Response(pdf, { status: 200, headers: { "content-type": "application/pdf" } }),
    );
    const client = new OpenEmrFhirClient({
      baseUrl: "https://oe.test",
      getAccessToken: async () => "TOKEN-B",
      fetchFn,
    });

    const bytes = await client.readBinary("bin-1");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual(Array.from(pdf));
    const call = fetchFn.mock.calls[0]!;
    expect(call[0]).toBe("https://oe.test/apis/default/fhir/Binary/bin-1");
    expect(new Headers(call[1]!.headers).get("authorization")).toBe("Bearer TOKEN-B");
  });

  it("throws a typed error on a non-2xx Binary fetch (no server text)", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 404 }));
    const client = new OpenEmrFhirClient({ baseUrl: "https://oe.test", getAccessToken: async () => "T", fetchFn });
    await expect(client.readBinary("missing")).rejects.toThrow(/status 404/);
  });

  it("builds a search query and returns the bundle", async () => {
    const fetchFn = vi.fn(async () => fhirResponse({ resourceType: "Bundle", entry: [] }));
    const client = new OpenEmrFhirClient({
      baseUrl: "https://oe.test/",
      getAccessToken: async () => "T",
      fetchFn,
    });

    const res = await client.search("Patient", { name: "Underwood" });
    expect(res).toMatchObject({ resourceType: "Bundle" });
    expect(fetchFn.mock.calls[0]![0]).toBe("https://oe.test/apis/default/fhir/Patient?name=Underwood");
  });

  it("throws a typed error without leaking server text on non-2xx", async () => {
    const fetchFn = vi.fn(async () =>
      fhirResponse({ issue: [{ diagnostics: "secret internal detail" }] }, 403),
    );
    const client = new OpenEmrFhirClient({
      baseUrl: "https://oe.test",
      getAccessToken: async () => "T",
      fetchFn,
    });

    await expect(client.read("Patient", "x")).rejects.toThrow(/fhir request failed/i);
    await expect(client.read("Patient", "x")).rejects.not.toThrow(/secret internal detail/);
  });
});
