import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app.js";

describe("GET / (dev chat page)", () => {
  it("serves an HTML page", async () => {
    const app = buildApp({ logger: false });
    const res = await app.inject({ method: "GET", url: "/" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.payload).toContain("<title>Clinical Co-Pilot");
    expect(res.payload).toContain("/chat");
    // The chat UI renders the machine-readable citation contract (grounded claim → source rows).
    expect(res.payload).toContain("data.citations");
    expect(res.payload).toContain("Sources (");
    await app.close();
  });
});
