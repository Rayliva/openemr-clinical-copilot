import { describe, it, expect } from "vitest";
import { createRedisReadinessCheck } from "../src/redis/readiness.js";

describe("createRedisReadinessCheck", () => {
  it("is ok when PING replies PONG", async () => {
    const check = createRedisReadinessCheck({ ping: async () => "PONG" });
    await expect(check()).resolves.toBe(true);
  });

  it("is not ok when PING replies something else", async () => {
    const check = createRedisReadinessCheck({ ping: async () => "nope" });
    await expect(check()).resolves.toBe(false);
  });

  it("propagates a thrown error (registry reports it as error)", async () => {
    const check = createRedisReadinessCheck({
      ping: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:6379");
      },
    });
    await expect(check()).rejects.toThrow();
  });

  it("rejects when PING exceeds the timeout", async () => {
    const check = createRedisReadinessCheck(
      { ping: () => new Promise((resolve) => setTimeout(() => resolve("PONG"), 100)) },
      5,
    );
    await expect(check()).rejects.toThrow(/timed out/);
  });
});
