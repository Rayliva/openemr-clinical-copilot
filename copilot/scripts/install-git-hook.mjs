// Auto-installs the Week-2 eval-driven pre-push gate. Wired to `pnpm prepare`, so the hook is set up
// whenever anyone (incl. a grader) runs `pnpm install` in copilot/. Git hooks are not committed, so
// this is what makes the PR-blocking gate active on a fresh clone. Cross-platform + non-fatal: a
// missing git dir (e.g. a source tarball) just skips silently — never breaks `pnpm install`.
//
// The installed hook runs copilot/scripts/eval-gate.sh, which blocks a push that regresses the full
// test suite or the 50-case golden-set eval gate. Manual equivalent: bash scripts/install-git-hooks.sh.

import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function git(cmd) {
  return execSync("git " + cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
}

let hooksDir;
try {
  hooksDir = resolve(git("rev-parse --git-path hooks")); // honors core.hooksPath
} catch {
  process.exit(0); // not a git working tree — nothing to install
}

const hookPath = resolve(hooksDir, "pre-push");
if (existsSync(hookPath) && !readFileSync(hookPath, "utf8").includes("eval-gate.sh")) {
  console.warn("[copilot] a pre-push hook already exists and is not the eval gate — left intact.");
  console.warn("[copilot] install the eval gate manually: bash copilot/scripts/install-git-hooks.sh");
  process.exit(0);
}

const hook =
  "#!/usr/bin/env bash\n" +
  "# Week-2 eval-driven gate (auto-installed by copilot prepare). Blocks a push that regresses the\n" +
  "# full test suite or the golden-set eval gate. Emergency bypass: git push --no-verify.\n" +
  'exec bash "$(git rev-parse --show-toplevel)/copilot/scripts/eval-gate.sh"\n';

try {
  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(hookPath, hook);
  chmodSync(hookPath, 0o755);
  console.log("[copilot] eval-gate pre-push hook installed at " + hookPath);
} catch (err) {
  console.warn("[copilot] could not install the pre-push hook (" + String(err) + ") — install manually.");
}
