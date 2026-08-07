import { describe, it, expect } from "vitest";
import { noPhiInLogsScorer } from "../../src/scorers/noPhiInLogs.js";
import { makeCase, makeOutput } from "./helpers.js";

describe("noPhiInLogsScorer", () => {
  it("reports nothing when the case does not list no_phi_in_logs", () => {
    const result = noPhiInLogsScorer(makeOutput(), makeCase({ category: ["schema_valid"] }));
    expect(result).toEqual({});
  });

  it("passes when no forbidden substring appears in any log line", () => {
    const result = noPhiInLogsScorer(
      makeOutput({ logs: ['{"level":"info","pid":7,"msg":"lab fetch ok"}'] }),
      makeCase({
        category: ["no_phi_in_logs"],
        expected: { forbiddenInLogs: ["Jane Doe", "MRN-12345"] },
      }),
    );
    expect(result).toEqual({ no_phi_in_logs: true });
  });

  it("fails when a forbidden substring leaks into a log line (regression catcher)", () => {
    const result = noPhiInLogsScorer(
      makeOutput({ logs: ["patient Jane Doe queried", "next line"] }),
      makeCase({
        category: ["no_phi_in_logs"],
        expected: { forbiddenInLogs: ["Jane Doe"] },
      }),
    );
    expect(result).toEqual({ no_phi_in_logs: false });
  });

  it("detects a forbidden substring embedded mid-line", () => {
    const result = noPhiInLogsScorer(
      makeOutput({ logs: ["id=MRN-12345;status=ok"] }),
      makeCase({ category: ["no_phi_in_logs"], expected: { forbiddenInLogs: ["MRN-12345"] } }),
    );
    expect(result).toEqual({ no_phi_in_logs: false });
  });

  it("vacuously passes when the forbidden list is empty or absent", () => {
    const result = noPhiInLogsScorer(
      makeOutput({ logs: ["anything at all"] }),
      makeCase({ category: ["no_phi_in_logs"], expected: {} }),
    );
    expect(result).toEqual({ no_phi_in_logs: true });
  });
});
