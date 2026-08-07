import { describe, it, expect } from "vitest";
import { redactUrlSecrets } from "../src/app.js";

describe("redactUrlSecrets", () => {
  it("redacts the ops token value in a query string", () => {
    expect(redactUrlSecrets("/metrics?token=supersecret")).toBe("/metrics?token=[REDACTED]");
    expect(redactUrlSecrets("/dashboard?token=abc123&window=500")).toBe(
      "/dashboard?token=[REDACTED]&window=500",
    );
  });

  it("redacts csrf tokens", () => {
    expect(redactUrlSecrets("/x?csrf_token_form=deadbeef")).toBe("/x?csrf_token_form=[REDACTED]");
  });

  it("leaves URLs without secrets unchanged", () => {
    expect(redactUrlSecrets("/chat")).toBe("/chat");
    expect(redactUrlSecrets("/ready?verbose=1")).toBe("/ready?verbose=1");
  });

  it("is case-insensitive on the param name", () => {
    expect(redactUrlSecrets("/m?TOKEN=x")).toBe("/m?TOKEN=[REDACTED]");
  });
});
