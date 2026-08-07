import type { FastifyPluginAsync } from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Build-id probe. A read-only, unauthenticated endpoint that returns an OPAQUE build id so an external
 * tool (the adversarial-AI security platform) can auto-stamp which build it tested and detect when the
 * deployed build changes. Public like `/health`, and deliberately returns ONLY a short commit sha, no
 * branch/dirty-state/dependency detail, so it leaks nothing beyond a mild fingerprint.
 *
 * Resolution order: `COPILOT_VERSION` env (explicit, wins) → the git HEAD of the deployed checkout
 * (automatic, zero deploy plumbing) → "unknown". The git read is fs-only (no git binary), bounded, and
 * fully guarded, so it can never throw or block the route.
 */
export const versionRoutes: FastifyPluginAsync = async (app) => {
  const version = resolveBuildId();
  app.get("/version", async () => ({ version }));
};

/** Resolve an opaque build id: explicit env → git HEAD short sha → "unknown". Never throws. */
export function resolveBuildId(env: NodeJS.ProcessEnv = process.env, startDir = moduleDir()): string {
  const explicit = env["COPILOT_VERSION"]?.trim();
  if (explicit) return explicit.slice(0, 200);
  const sha = gitHeadSha(startDir);
  return sha ?? "unknown";
}

function moduleDir(): string {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

/**
 * Best-effort short commit sha from the deployed git checkout, read straight off the filesystem (no git
 * binary needed): walk up to find a `.git` directory, read HEAD, and resolve a loose ref or a detached
 * sha. Anything unusual (packed refs, a `.git` file/worktree, no repo) returns null so the caller falls
 * back to "unknown" (set COPILOT_VERSION explicitly in that case). Always guarded, never throws.
 */
export function gitHeadSha(startDir: string): string | null {
  try {
    let dir = startDir;
    for (let i = 0; i < 12; i++) {
      const gitDir = join(dir, ".git");
      if (existsSync(gitDir)) {
        // Only handle a real .git DIRECTORY (the common checkout case); a .git file (worktree/submodule)
        // is left to the explicit env override.
        const head = safeRead(join(gitDir, "HEAD"));
        if (!head) return null;
        const m = head.match(/^ref:\s*(.+?)\s*$/);
        if (m) {
          // Only follow a well-formed ref under refs/ (never `..` or an absolute path), so a malformed
          // HEAD can't turn this into an arbitrary-file read (defense-in-depth; HEAD is not
          // attacker-controlled in a normal deploy, but this is a clinical SUT).
          const refPath = m[1]!;
          if (!refPath.startsWith("refs/") || refPath.includes("..")) return null;
          const ref = safeRead(join(gitDir, refPath));
          const sha = ref?.trim();
          return sha && /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 12) : null;
        }
        // Detached HEAD: the file is the sha itself.
        const sha = head.trim();
        return /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 12) : null;
      }
      const parent = dirname(dir);
      if (parent === dir) break; // reached filesystem root
      dir = parent;
    }
  } catch {
    /* fall through to null */
  }
  return null;
}

function safeRead(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
}
