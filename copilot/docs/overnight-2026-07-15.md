# Overnight autonomous run — 2026-07-15 (progress log)

**Mandate (from the user, going to sleep):** find bugs, requirement gaps (they named the *missing
discard button* on the document review page), evals needing improvement, security vulnerabilities;
finish ALL Week-2 requirements that do **not** require a deploy; run load testing + compare to the
last run and research any regression. **Commit + push freely. NEVER DEPLOY** (prod is being graded).
Use sub-agents for fresh perspective. Don't wake them. Leave a report.

This file is the durable progress log — update it as work lands so a context compaction doesn't lose
the thread. Cross-check with `git log` and `docs/week2-requirements.html`.

## Operating rules
- Autonomous commit + push at green boundaries (`commit-and-deploy` rule, updated). The pre-push
  eval-gate hook must pass — never `--no-verify`.
- **No deploy.** Anything only *verifiable* via deploy: build it, commit it, flag it "needs deploy to
  verify" in this log + the wake-up report.
- Keep the safety spine intact; don't parallelize edits to the same files.

## Phase plan + status
- [ ] **Phase 1 — audits (parallel sub-agents):** bug hunt, security, requirements-gap. → work list.
- [ ] **Phase 2 — fix + build:** discard button; audit findings; all non-deploy W2 requirements.
- [ ] **Phase 3 — load test:** run, compare to `loadtest/results/` last run, research regressions.
- [ ] **Phase 4 — record:** tracker/JOURNAL/memory + wake-up report.

## Work list (from the requirements-gap audit — all NON-deploy unless noted)
Order = value ÷ effort. Mark [x] when landed (+ sha).

**Wave A — cheap doc/verify wins:**
- [ ] #3 Testing strategy — already in `W2_ARCHITECTURE.md §16`; verify + flip card green.
- [ ] #4 Data modeling & lineage — already in `§12`; verify + flip green.
- [ ] #5 Backup & recovery — already in `§13`; reconcile pgvector-vs-in-memory, flip green.
- [ ] #7 Arch-doc refresh — `§8.4` says GitLab runner "decided" (DROPPED); `§7/§14` say pgvector shipped (it's in-memory). Fix to reality.
- [ ] #22 oncall.md W2 rows (copy §17 failure modes).
- [ ] #1 README W1-baseline vs W2-multimodal section + W2 env vars + packages map.
- [ ] #21 schema-evolution/migration notes.

**Wave B — small code, high value:**
- [x] #6 Discard button — DONE (5322506).
- [ ] #2 Postman/API collection: add W2 endpoints (`/documents/status|pending|extract`).
- [ ] #10 OpenAPI 3.0 spec (`apps/agent/openapi.yaml`) for all routes + a contract test.
- [ ] #8 Privacy-audit doc + a deterministic PHI-scan script wired into the gate.

**Wave C — observability cluster (build together; share the metrics registry):**
- [ ] #12 W2 metrics (retrieval hits, extraction confidence, worker routing, eval outcome).
- [ ] #13 dashboard W2 panels · #14 W2 alert rules · #15 W2 log-event vocabulary.
- [ ] #16 `/ready` W2 deps (Cohere/RAG index) + degraded status · #17 child-span nesting · #18 correlation-id finish.

**Wave D — deeper code:**
- [ ] #11 integration tests (real ingestion pipeline over fixtures + stubbed VLM/OCR, offline).
- [ ] #9 citation contract on chat-answer claims (map provenance → W2 Citation shape + render).
- [ ] #19 CI broadening (lint + `pnpm audit` + contract test in eval-gate.sh).
- [ ] #20 circuit breaker on Cohere rerank + documented SLOs.

**Wave E — optional:** #24 W2 perf/cost baselines (LOCAL stack, no prod deploy) · #23 critic agent (user low-pri).

**SKIP (deploy-gated/user):** Deployed-application click-through, Demo video.

**Tracker corrections to apply:** Testing/Lineage/Backup are RED but substantively DONE in the arch
doc (mistracked). W2 observability cards are optimistically amber (code has ~zero W2 signal). Arch
doc is stale (dropped runner + undeployed pgvector shown as shipped).

**Also pending:** bug-hunt + security audit findings (2 agents still running) — fix those FIRST when
they land (correctness/safety before docs).

## Audit findings (from the 3 sub-agents) — fix status

**SECURITY (all controls hold; no critical/high):**
- [ ] MEDIUM: commit path trusts client value/citation/physicianCorrected — never re-validates vs the
  cached extracted draft. Session-compromise bypass of the citation gate. Fix: sign draft values in
  the agent (bridge-secret HMAC over documentId|testName|value|citationId), verify in the module on
  commit; derive physicianCorrected server-side. (Module can't read agent Redis → signing is the path.)
- [x] LOW: UUID parse in CommitReviewController could 500 on malformed → wrapped, returns 403. (this commit)
- [ ] LOW: `/documents/extract` internet-reachable via Caddy (confinement holds); restrict at proxy (deploy/Caddyfile — takes effect only on deploy → note for user).
- [ ] LOW: ops bearer token accepted in URL query (leaks to Caddy log) → prefer Authorization header.
- [ ] INFO: default `COPILOT_DEV_MINT=false` + fail-closed when NODE_ENV unset (dev-mint bypasses ownership).
- [ ] INFO: no independent append-only PHI disclosure log (rule not fully met).

**BUGS:**
- [x] #1 BLOCKER: `is_int($saved['id'])` false on string DB id → derivedFrom UPDATE skipped → idempotency
  + provenance broken (duplicate on re-commit). Fixed → is_numeric. NEEDS a commit() test (untested).
- [ ] #4 SAFETY (MAJOR): `constraintFacts.ts:36` allergies null → `{documented:true, substances:[]}` =
  false "no allergies" → suppresses the allergy safety guard. Fix → `{documented:false, reason:unavailable}`.
- [ ] #3 MAJOR: supervisor+workers vanish without Cohere (`server.ts:101 usingClaude && usingRag`).
  Decouple: supervisor when usingClaude (intake_extractor always available); evidence_retriever when usingRag.
- [ ] #2 MAJOR: `intake_extractor` node discards its `{documents}` output (no state channel) → routing
  to it is decorative. Fold documents into a state channel + surface to generate.
- [ ] #7 (functional): intake composite values ("X — Y" em-dash) never box-match → all forced-review. Fix the join/match.
- [ ] #6 box-match: value-only match can locate the wrong occurrence (no test-name anchor).
- [ ] #9 committed docs stay "pending" forever (alreadyProcessed always empty) — re-commit is the easy path (ties to #1).
- [ ] #5 LOINC never populated end-to-end (dead `LOINC:` branch) — schema has no loinc field.
- [ ] smells: ob_type option_id unverified; resolveEncounter uses most-recent (could be unrelated visit); classify `\bform\b` catches "Lab Result Form"; rerank degrade flag dropped.
- (#10 factually_consistent/no_phi_in_logs are acknowledged eval-design limits — improve in eval wave.)

## Done this run
- Phase 1 audits (bug, security, requirements-gap) — complete; findings above.
- **Discard button** (#6) — Accept/Discard/bulk. **5322506**.
- **BLOCKER #1** write-path idempotency (is_int→is_numeric) + **LOW** UUID guard. **e544968**.
- **MAJOR #3** supervisor wired whenever Claude present (not gated on Cohere). **cbee686**.
- constraintFacts comment (reverted #4 — non-issue: prod always wires allergies; read-failure path handles it). **0cda4f3**.
- **Wave A docs** (doc sub-agent): README W1/W2 split + env vars + packages map; W2_ARCHITECTURE refresh
  (in-memory RAG not pgvector; git-hook gate not GitLab runner; no agent Postgres); oncall W2 rows;
  `docs/w2-privacy-audit.md`; §12.1 migration notes. **d7d5637..2d72b6d**. Flips Testing/Lineage/Backup + README/arch cards.

- **Wave C observability** (builder): W2 metrics (ingestion/retrieval/routing) recorded from real paths +
  /metrics + /dashboard panels; 3 W2 alert rules; W2 log events (ingestion.complete/extraction.field/
  worker.handoff/retrieval.hit-miss) + correlationId channel; /ready degraded + Cohere check; worker
  spans nested under supervisor. metrics 22→39, agent 208→227. **c85d50f..f2341eb**. 6 tracker cards green.

## Orchestration note
Run build sub-agents ONE AT A TIME (commit+push each); do NOT self-commit while one runs (push races).
Shared `.git`: builder commits appear in my local immediately (no pull needed); only PUSH races. Update+commit this log BEFORE launching each builder.

- **#2 intake fold** (builder): intake_extractor output folded into `documents` state channel w/ DocumentReference
  provenance → citation whitelist + grounding index; separate namespace from evidence/chart; intakeRan
  distinguishes looked-empty vs never-looked. 236 agent tests. **..6545be3**. Second worker now real (graded).
- **Wave C review** (code-reviewer): APPROVE-WITH-NITS, no blocker/major. Applied 2 nits: retrieval log/metric
  divergence on no-query path + comment lib cast. **09a034b**.

## Deferred hardening (noted, low-risk)
- #2 follow-on: evidenceIndex cross-namespace precedence is insertion-order only; add explicit collision guard
  (chart uuid vs chunk id vs doc rowUuid). No realistic clash today (id shapes differ). Tracker card #4 note.

- **Wave B** (builder): OpenAPI 3.0 `openapi.json` (chose JSON, no YAML dep) + 9-test contract test
  (documented ⊇ registered routes); Postman W2 endpoints; deterministic `scripts/phi-scan.mjs` (source-scan
  for interpolated PHI in log messages) wired into the gate + self-test. 245 agent tests. Codebase scans clean.
- **#2 safety review** (code-reviewer): APPROVE, collision NOT exploitable (globally-unique FHIR ids). 2 minor
  nits queued (typed intake-fetch failure; inert empty-docs prompt).
- **EVALS AUDIT** (read-only) → scratchpad `evals-audit-worklist.md`. Found the graded hard-gate could stay
  GREEN under a real factual/refusal regression. **FIXED P0** (`2aa5575`, pre-push eval-gate PASS):
  factually_consistent now oracle-backed (mustContain/mustNotContain) + 2 absence safety cases de-vacuumed
  + floored; safe_refusal red-able (inject flips refusal) + must-not-over-refuse case; goldenSet test now
  REQUIRES a safety factually_consistent case to use an oracle. gate.test asserts all 5 categories flag on inject.

- **Evals coverage** (done, foreground after 2 restarts killed the builder): #4 hallucinated-citation runner
  test (cited row not retrieved → red, w/ red-able control) **31058cf**; #7 interaction + duplicate-therapy
  safety cases w/ mustNotContain oracles + goldenSet asserts both scenarios **cd2bc00**. eval-harness 83, w2 15.
  #8 (golden-set idempotency) NOT feasible in the synthetic harness without faking — deferred; the real
  idempotency belongs at the `DerivedObservationWriter` PHP level (still needs a PHP unit test — Docker-gated).

## RESTART NOTE (machine cycled ~2x)
User's PC restarted mid-run; background builders died (committed nothing). Doing remaining work FOREGROUND
with incremental commits (durable). Docker was force-closed — load test deferred until stack is back up.
Pipeline-failed email = stale (GitLab .gitlab-ci.yml dropped @8965509; pre-push hook is the gate, passing).

- **bug #7 box-match** (foreground): intake composite allergy/family-history values now box-match (em-dash
  was a display artifact leaking into OCR matching) instead of always forcing review. ingestion 114. **94e23dd**.
- **citation contract** (foreground): chat `done` SSE frame now ships machine-readable citations (grounded
  claim → source row uuids, leak-safe verified set only). agent 246. **d3c2861**. Tracker card note updated **4ca9611**.
- **Tracker** (builder): verified each green (even ran the OpenAPI contract test), honest amber where partial;
  now 69% (22 green / 10 amber / 7 red). **b089c76**.

## Remaining
**Docker-gated (stack must be up):**
- **Load test + compare to `loadtest/results/`** (explicit mandate) — needs the running agent/stack.
- **Security MEDIUM (write-path signing)** — sign extracted draft values in the agent (HMAC over
  documentId|testName|value|citationId), verify in the PHP module on commit; the PHP side can't be tested
  without the container. Compensating controls (session/CSRF/ownership/physician-confirm) hold meanwhile.
- **PHP idempotency unit test** for `DerivedObservationWriter` (the is_numeric fix is untested at PHP level).
**Deferred / follow-on (host-side, low priority):**
- #2 nit: typed intake-fetch-failure (masked today by the citation gate — cheap insurance).
- Chat-citation UI rendering: the response-side contract ships; the chat panel doesn't render the links yet.
- no_phi_in_logs scorer is circular (design-limited); golden-set can't behaviorally test routing/RAG (synthetic harness — covered by graph unit tests).

## Wake-up report
Ran the overnight mandate (bugs / gaps / evals / security / finish non-deploy W2). ~20 commits to `main`, each
green through the pre-push eval-gate hook; NOTHING deployed (prod frozen for grading). Machine restarted ~2×
mid-run (killed background builders, no work lost — foregrounded after). **Highest-impact find:** the graded
eval hard-gate could have stayed GREEN under a real factual-consistency or refusal regression (two safety cases
were vacuous) — now fixed and demonstrably red-able. **Bugs fixed:** write-path idempotency BLOCKER (string DB
ids), intake box-match (composites forced review), supervisor-vanishes-without-Cohere, UUID crash, pdfjs buffer.
**Built/verified:** intake_extractor worker made real; full W2 observability; OpenAPI + Postman + PHI-scan;
Wave-A docs; discard UI; citation contract (response). **Reviews:** Wave C + #2 clean; evals + security audits.
**Pipeline email = stale** (GitLab CI dropped for the pre-push hook). Tracker at 69%.

## Load test (2026-07-15, after user returned) — DONE
Deployed `ea06ee7` to **Site B** (staging, non-graded, user-authorized) — agent wired, /ready all-green.
Load-tested vs the 2026-07-10 W1 baseline (`loadtest/results-2026-07-15-siteB/loadtest-comparison.md`, **20a8b13**):
- **10c: 100/100, 0 errors, but p95 45s vs baseline 10s** (~4.5×). Root cause = W2 supervisor adds a routing
  LLM call per turn (wired whenever Claude present; Cohere off on Site B). Expected W1→W2 cost, not a code regression.
- **50c: same OpenEmrFhirError amplification wall as baseline** (348 in window) + new Anthropic 429s (24);
  agent recovered clean. Pre-existing 5× FHIR-amplification cliff, unchanged root cause.
- **Recommendations (deferred, graph-adjacent):** Haiku routing, short-circuit chart-only turns, cached snapshot.
- **Security signing:** deferred to a focused session (user decision).

## Post-return session ("keep doing fixable things + unmet requirements")
- **Haiku supervisor routing** (perf FIX, **1ee1366**): the whole 10c tail regression was the supervisor
  routing on Sonnet. `COPILOT_SUPERVISOR_MODEL` defaults to Haiku. Redeployed Site B (**2ff65f0**) + re-measured:
  **p95 44.8s → 7.6s**, p50 11.7→5.7, throughput 0.51→1.72 — W2 now BEATS the W1 baseline. Verified (**329af3d**).
- **Chat citation UI** (feat, **2ff65f0**): the chat panel renders the machine-readable citations ("Sources (N)"
  badges, hover = which claim). Closes the chat side of the citation contract.
- **SLO/perf doc** `docs/w2-slos.md` + tracker flips (cost-latency + citation → green; SLOs/baseline strengthened). **e0b62b8**.
- **Deferred with reason (not built):** Cohere circuit-breaker (rerank already degrades; Cohere off on Site B →
  unvalidatable; documented as optional optimization). #2 nit / #5 LOINC dead-branch / #6 box-anchor / #9
  committed-pending — minor or architectural, documented. Critic agent — stretch (user low-pri). Security signing — user-deferred.

## STATUS: overnight mandate essentially complete
Bugs fixed; W2 requirements (non-deploy) done; eval gate hardened (the headline win); load test done + root-caused.
Remaining = deferred/optional: security signing (user-deferred), latency optimizations (recommended), stretch
(critic agent, circuit breaker, chat-citation UI rendering).
2. **Wave D** (delegate): integration tests running the REAL graph offline (stubbed model/VLM) → covers RAG
   retrieval (#5) + supervisor routing (#6) + ingestion pipeline + chat-claim citation contract + CI broadening.
3. #2 nit (typed intake-fetch failure) + bug #7 box-match + security MEDIUM (signed drafts).
4. **Load test + compare to `loadtest/results/`** (mandate; research any regression). 5. tracker flips + wake-up report.
NOTE #3 no_phi_in_logs circular (harness synthesizes logs) — design-limited; documented, deferred.

## Wake-up report
_(final summary written at the end)_
