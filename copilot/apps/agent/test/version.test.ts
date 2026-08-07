import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";
import { resolveBuildId, gitHeadSha } from "../src/routes/version.js";

describe("GET /version", () => {
  it("returns 200 with an opaque build id string", async () => {
    const app = buildApp({ logger: false });
    const res = await app.inject({ method: "GET", url: "/version" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { version: string };
    expect(typeof body.version).toBe("string");
    expect(body.version.length).toBeGreaterThan(0);
    await app.close();
  });
});

describe("resolveBuildId", () => {
  it("prefers the COPILOT_VERSION env override", () => {
    expect(resolveBuildId({ COPILOT_VERSION: "deploy-abc123" } as NodeJS.ProcessEnv, "/nonexistent")).toBe("deploy-abc123");
  });

  it("falls back to 'unknown' when there is no env override and no git checkout", () => {
    expect(resolveBuildId({} as NodeJS.ProcessEnv, join(tmpdir(), "no-repo-here-xyz"))).toBe("unknown");
  });

  it("reads a loose ref sha from a .git checkout (walks up to find it)", () => {
    const root = mkdtempSync(join(tmpdir(), "gitrepo-"));
    try {
      const sha = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
      mkdirSync(join(root, ".git", "refs", "heads"), { recursive: true });
      writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
      writeFileSync(join(root, ".git", "refs", "heads", "main"), sha + "\n");
      const nested = join(root, "apps", "agent", "src");
      mkdirSync(nested, { recursive: true });
      // Walks up from the nested dir, finds .git at the root, returns the short sha.
      expect(gitHeadSha(nested)).toBe(sha.slice(0, 12));
      expect(resolveBuildId({} as NodeJS.ProcessEnv, nested)).toBe(sha.slice(0, 12));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns null for a non-hex ref target and for an out-of-refs symref (never reads arbitrary files)", () => {
    const root = mkdtempSync(join(tmpdir(), "gitbad-"));
    try {
      mkdirSync(join(root, ".git", "refs", "heads"), { recursive: true });
      // A ref whose target file is not a sha → rejected (null), so it can never become a "version".
      writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
      writeFileSync(join(root, ".git", "refs", "heads", "main"), "not-a-sha\n");
      expect(gitHeadSha(root)).toBeNull();
      // A symref escaping refs/ (a malformed HEAD) is refused outright, not followed.
      writeFileSync(join(root, ".git", "HEAD"), "ref: ../../../../etc/passwd\n");
      expect(gitHeadSha(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads a detached-HEAD sha", () => {
    const root = mkdtempSync(join(tmpdir(), "gitdetached-"));
    try {
      const sha = "0f1e2d3c4b5a69788796a5b4c3d2e1f000112233";
      mkdirSync(join(root, ".git"), { recursive: true });
      writeFileSync(join(root, ".git", "HEAD"), sha + "\n");
      expect(gitHeadSha(root)).toBe(sha.slice(0, 12));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
