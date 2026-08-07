import { describe, it, expect, vi } from "vitest";
import { createCircuitBreaker, CircuitOpenError } from "../src/cohere/circuitBreaker.js";

/** A deterministic clock the test advances explicitly (no real time). */
function fakeClock(start = 1000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

const ok = async (): Promise<string> => "ok";
const boom = async (): Promise<string> => { throw new Error("dep down"); };

describe("createCircuitBreaker", () => {
  it("passes successful calls through while closed and resets the failure count", async () => {
    const cb = createCircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, now: () => 0 });
    expect(await cb.run(ok)).toBe("ok");
    expect(cb.state()).toBe("closed");
  });

  it("rethrows the underlying error (never swallows it) while closed", async () => {
    const cb = createCircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, now: () => 0 });
    await expect(cb.run(boom)).rejects.toThrow("dep down");
  });

  it("opens after the threshold of consecutive failures and then fails fast without calling fn", async () => {
    const clock = fakeClock();
    const cb = createCircuitBreaker({ failureThreshold: 3, cooldownMs: 5000, now: clock.now });
    for (let i = 0; i < 3; i += 1) {
      await expect(cb.run(boom)).rejects.toThrow("dep down");
    }
    expect(cb.state()).toBe("open");

    const fn = vi.fn(ok);
    await expect(cb.run(fn)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled(); // fail-fast: the wrapped dependency is not touched while open
  });

  it("a run in the closed state resets failures so intermittent errors do not trip it", async () => {
    const cb = createCircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, now: () => 0 });
    await expect(cb.run(boom)).rejects.toThrow();
    await expect(cb.run(boom)).rejects.toThrow();
    await cb.run(ok); // success resets the counter
    await expect(cb.run(boom)).rejects.toThrow();
    expect(cb.state()).toBe("closed"); // only 1 failure since the reset
  });

  it("half-opens after the cooldown: a success closes it", async () => {
    const clock = fakeClock();
    const cb = createCircuitBreaker({ failureThreshold: 2, cooldownMs: 5000, now: clock.now });
    await expect(cb.run(boom)).rejects.toThrow();
    await expect(cb.run(boom)).rejects.toThrow();
    expect(cb.state()).toBe("open");

    clock.advance(5000); // cooldown elapsed → half-open
    expect(cb.state()).toBe("closed");
    expect(await cb.run(ok)).toBe("ok"); // trial succeeds → stays closed
    expect(cb.state()).toBe("closed");
  });

  it("half-opens after the cooldown: a single failed trial re-opens immediately", async () => {
    const clock = fakeClock();
    const cb = createCircuitBreaker({ failureThreshold: 2, cooldownMs: 5000, now: clock.now });
    await expect(cb.run(boom)).rejects.toThrow();
    await expect(cb.run(boom)).rejects.toThrow();

    clock.advance(5001); // half-open
    await expect(cb.run(boom)).rejects.toThrow("dep down"); // trial fails
    expect(cb.state()).toBe("open"); // re-opened on the single half-open failure
  });
});
