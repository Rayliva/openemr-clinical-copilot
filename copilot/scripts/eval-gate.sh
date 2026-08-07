#!/usr/bin/env bash
#
# Week 2 eval-driven HARD GATE — the authoritative regression gate (`.claude/rules/w2-eval-gate.md`,
# memory `w2-ci-runner-plan`). Runs the eval harness fully OFFLINE + DETERMINISTIC (a stubbed
# LLM/VLM/OCR + committed fixtures — NO live API keys), so an injected regression fails reproducibly.
# Exits non-zero on any failure; the pre-push hook (copilot/scripts/install-git-hooks.sh) blocks the
# push on a non-zero exit. Runs on the HOST (Node/pnpm) — the repo's prek hooks route PHP through the
# openemr container, but the copilot gate is host-side, so it lives outside prek.
#
# Bypass in a genuine emergency with `git push --no-verify` (never to skip a real regression).
set -euo pipefail

# copilot/ project root (this script lives in copilot/scripts/).
COPILOT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$COPILOT_ROOT"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "eval-gate: FAIL — pnpm is not on PATH; cannot run the Week 2 eval gate." >&2
  echo "           Install Node + pnpm (corepack enable), or push with --no-verify only if you are" >&2
  echo "           certain the change does not touch the copilot sidecar." >&2
  exit 1
fi

VITEST_BIN="packages/eval-harness/node_modules/.bin/vitest"
if [ ! -x "$VITEST_BIN" ] && [ ! -f "$VITEST_BIN" ]; then
  echo "eval-gate: dependencies missing — running 'pnpm install --frozen-lockfile'…" >&2
  pnpm install --frozen-lockfile
fi

echo "eval-gate: running the full test suite + the eval gate (offline, deterministic)…"

# 0. Deterministic PHI-leak guard (no LLM): fail the push if any structured-logger call interpolates
#    a variable into its MESSAGE (the error-handling-and-logging antipattern — leaks PHI/secrets and
#    is not queryable). Self-test first (prove the detector trips), then scan apps/ + packages/.
node scripts/phi-scan.mjs --self-test
node scripts/phi-scan.mjs

# 1. The FULL workspace suite — so a regression ANYWHERE (schemas, scorers, tools, verification,
#    ingestion, the agent) blocks the push, not just a change inside the eval packages.
pnpm -r test

# 2. THE GATE: the 50-case golden set + the prove-the-red self-test (happy run PASSES, the injected
#    regression FAILS) — the eval-driven centerpiece. Lives outside the workspace, so run explicitly.
"$VITEST_BIN" run --config evals/w2/vitest.config.ts

echo "eval-gate: PASS — no regression; push allowed."
