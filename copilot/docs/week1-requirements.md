# Week 1 — Graded Requirements — Clinical Co-Pilot (source of truth for submission)

> **This is the WEEK 1 board.** Week 2 has its own tracker:
> [`docs/week2-requirements.html`](week2-requirements.html) (source:
> `Week_2_AgentForge.pdf`). Rule of thumb: **anything unmarked is Week 1 baseline;
> new Week 2 artifacts carry a `W2` / `w2-` marker** (`W2_ARCHITECTURE.md`,
> `docs/specs/w2-*.md`, eval cases tagged `week:2`). Do not merge the two boards.
>
> **Read this before planning any work.** These are the assignment's graded
> requirements (from `Week_1_AgentForge.pdf`). Every slice must move one or more toward
> 🟢. Keep statuses + **artifact names** current as work lands. Final deadline:
> **Sunday 11:59 AM CT**. Design source of truth: `../../AUDIT.md`, `../../USERS.md`,
> `../../ARCHITECTURE.md`. Progress detail in memory `slice-status` + `docs/specs/`.
>
> **Recurring gotcha the rubric cares about:** several deliverables must exist as a
> *saved file* (eval **results**, load **results**, **baselines**), not just as
> working machinery. Those are flagged 🔴/🟡 below even where the code exists.

## Agent requirements
| Requirement | Status | Artifact / gap |
|---|---|---|
| **Agentic chatbot** (multi-turn, tools, traces to a use case) | 🟢 | `apps/agent` — LangGraph `POST /chat` SSE, multi-turn, real Claude; pid bound by signed token. **7 chart tools**: demographics, medications (+dosage/`authoredOn`), allergies, problems, immunizations, **vitals + labs** (`Observation`, 2026-07-11). **Agentic tool-calling (2026-07-11, `docs/specs/agentic-tool-calling.md`) — closes the prior "not LLM tool-calling" gap:** the safety core (demographics/problems/meds/allergies) is always fetched (constraint engine needs it every turn), optional tools are LLM-selected in a `gather` node. *Remaining:* encounters + MedicationDispense unwired (roadmap `docs/specs/chart-data-coverage.md`). |
| **Verification — source attribution** | 🟢 | `@copilot/verification/citations.ts` (layer 1) |
| **Verification — semantic grounding** | 🟢 | `@copilot/verification/grounding.ts` (layer 2, Haiku judge; opt-in `COPILOT_GROUNDING_JUDGE`). **Bounded regenerate-with-feedback** added 2026-07-10 (`checkGroundingWithRegeneration`): a failed grounding check feeds the judge's reasons back to the generator for one bounded retry — re-gated through L1+L2 — before degrading (`verification-gate` rule); spec `docs/specs/grounding-judge.md`. |
| **Verification — domain constraints** | 🟢 | `@copilot/verification/constraints.ts` (layer 3); spec `docs/specs/clinical-constraint-engine.md`. Catches med-status conflict, duplicate therapy, undocumented-allergy guard, allergy contraindication. Documented limits: no computed DDI/renal DB. |
| **Observability** (steps/order, per-step latency, tool failures, tokens+cost) | 🟢 | self-hosted Langfuse (span per node/LLM, correlation id, tokens+cost) + `pino` logs. **Per-tool** spans + failure attribution added 2026-07-10 (previously all 5 tools shared one `assembleContext` span, so "tool failures" was not actually observable per tool). Dashboard view = E4 🟢. |
| **Evaluation** (failure modes, edge cases incl. unauthorized) | 🟢 | Suite ✅ `evals/promptfooconfig.yaml` (7 cases) + `agentProvider.mjs`; spec `docs/specs/eval-suite.md`. **Results saved** → `evals/results/eval-results.json` + `eval-results.md` (2026-07-10, **7/7 = 100%**, grounding-on prod config, real /chat latency p50 7.5s/p95 13.7s). *Ownership refusal — clarified 2026-07-12:* the ownership gate (the one control compensating for OpenEMR's role-level token) **is unit-tested** — `oe-module-copilot/tests/Tests/Unit/PanelServiceTest.php::testRefusesAPidNotOnThePanel` asserts a non-owned pid (3, Wanda Moore) never resolves to a FHIR id, so no token is ever minted for it. The promptfoo eval **cannot** exercise HTTP mint-refusal because its `dev-mint` endpoint bypasses ownership by design (a dev stand-in); the agent-level guarantee (bound to Susan, architecturally cannot fetch pid 3) **is** covered by the `[safety] authz/pid-scope injection-no-leak` eval case. So the control is covered end-to-end across the two test layers; the only untested slice is the PHP controller's 403 wiring over real HTTP, which needs an authenticated OpenEMR session the headless eval doesn't have. |

## Engineering requirements
| # | Requirement | Status | Artifact / gap |
|---|---|---|---|
| E1 | Boundary/invariant/regression tests + documented failure modes | 🟢 | unit tests + `evals/`; `docs/specs/eval-suite.md` |
| E2 | Correlation ID across every log/tool/LLM | 🟢 | wired end-to-end |
| E3 | Zod contracts = source of truth (every tool I/O) | 🟢 | `packages/*/src` Zod schemas |
| E4 | **Dashboard** (req count, error rate, p50/p95, tool-call counts, retries, verification pass/fail) | 🟢 | `packages/metrics` (pure registry) + `GET /metrics` (JSON) + `GET /dashboard` (HTML), both behind `COPILOT_METRICS_TOKEN`. Spec `docs/specs/observability-dashboard.md`. Live-verified. `retriesTotal` now has a real source (the grounding regenerate loop, 2026-07-10) and `retryPathImplemented` is `true`. *Honest gap:* `verdictOk` not yet a Langfuse score, so longitudinal verification trend isn't queryable. |
| E5 | Runnable API collection | 🟢 | `api/copilot.postman_collection.json` + env; `pnpm api:smoke` |
| E6 | Separate `/health` + `/ready` (validates deps) | 🟢 | done |
| E7 | **≥3 alerts + on-call docs** | 🟢 | **4 alerts** (`evaluateAlerts` in `@copilot/metrics`, thresholds from E9): high_error_rate, high_latency_p95, tool_failure_rate (FHIR-saturation early warning), verification_fail_rate (trust). Volume-gated anti-flap. `GET /alerts` (token-gated, logs firing structured) + runbook `docs/oncall.md`. Spec `docs/specs/alerts-and-oncall.md`. *v1:* firing is logged, not externally paged (documented seam). |
| E8 | **Baseline** CPU/mem/latency/throughput | 🟢 | `loadtest/results/loadtest-results.{json,md}` + `docker-stats-during-load.txt` — CPU/mem sampled under load (agent light; **OpenEMR peaks >1 core**), latency + throughput per level. |
| E9 | **Load/stress 10 & 50 concurrent vs deployed** (p50/p95/p99 + error rate) | 🟢 | `loadtest/results/` — 10c: **0% err, p95 10.2s**; 50c: **73% err (all OpenEMR FHIR 500s), p95 31.7s**. Root cause: 5 FHIR reads/turn × 50 = ~250 concurrent FHIR calls saturate OpenEMR; fix = Redis snapshot cache + per-tool isolation. |

## Submission deliverables
| Deliverable | Status | Artifact / gap |
|---|---|---|
| GitHub repo: fork + **setup guide** + arch overview + deployed link | 🟢 | Fork ✅; arch ✅ `ARCHITECTURE.md`; link ✅. **Setup guide ✅** `copilot/README.md` (prereqs → OpenEMR stack → OAuth register → env → services → seed → run → test → ops → deploy, + doc map). *Note:* the fork's root README is still stock OpenEMR; the co-pilot guide lives at `copilot/README.md` (the project root). |
| `AUDIT.md` (+~500w summary) | 🟢 | `/AUDIT.md` |
| **`USER.md`** (rubric filename) | 🟢 | `/USER.md` (mirrors `/USERS.md`) |
| `ARCHITECTURE.md` (+~500w summary) | 🟢 | `/ARCHITECTURE.md` |
| **Demo video** (3–5 min) | 🔴 | user-produced |
| **Eval dataset + results** | 🟢 | Dataset ✅ `evals/promptfooconfig.yaml`; **results ✅** `evals/results/eval-results.json` + `.md` (7/7, 100%, 2026-07-10) |
| **AI cost analysis** | 🟢 | `docs/cost-analysis.md` (actual spend + 100/1K/10K/100K projections) |
| **Deployed application** (works live) | 🟢 | **Blue/green — TWO sites** (memory `two-site-deploy`, JOURNAL 2026-07-11): **Site A** https://copilot.203-0-113-10.sslip.io (`root@203.0.113.10`) + **Site B** https://copilot.203-0-113-20.sslip.io (`root@203.0.113.20`), identical stacks that alternate graded-vs-staging each cycle (submit one URL, freeze it; use the other to test; swap). Login (both): `physician`/`<demo-password — in memory two-site-deploy, not committed>` (clinician; widget is clinician-gated). **A and B IN PARITY as of 2026-07-12 — both on main `1a46b7f`** (this session's quality fixes deployed to both: parallel grounding judge, dosage-in-evidence fix, gather-history fix, patient-age answering, Co-Pilot-tab removal, Langfuse-flush-off-critical-path, Langfuse-healthcheck fix). Deploy = `git pull --ff-only && docker compose up -d --build --wait` on the target droplet (key `id_ed25519_openemr_do`); PHP-module changes need only `git pull` (OpenEMR bind-mounts the repo). See `deploy-do` skill / memory `two-site-deploy` for the git-`safe.directory` + verify-the-pull-landed gotchas. `/ready` all-green on both. |
| **Social post** (final only) | 🔴 | user-produced |

## Enhancement requests (from the physician / product owner, 2026-07-09)
These are requested improvements beyond the base rubric; fold into the agent's final
state before the deploy→load→dashboard chain where they change the contract/latency.
| Item | Status | Notes |
|---|---|---|
| **Output concision** — responses are too wordy | 🟢 | `f4d2137` — generate prompt tightened (one-sentence claims, no restated caveats). Safety-flag text preserved verbatim, so the eval safety subset is unaffected. |
| **Cleaner safety-flag presentation** | 🟢 | `f4d2137` — flags render as compact colored chips (amber=warning, grey=info); grounding "omitted (unverified)" note below the answer bubble. Streamed text unchanged. |
| **Chat UI polish** — typing animation in a bubble | 🟢 | `f4d2137` — typing indicator + message bubbles in both `apps/agent/src/routes/ui.ts` (dev page) and `oe-module-copilot/public/index.php` (embedded). |
| **Daily-overview view = UC-1** (flagship morning huddle) — lives in the **existing "Co-Pilot" header tab**: repurpose the full-page module (`oe-module-copilot/public/index.php`) from a patient *switcher* into the day's overview — **no patient toggling**. Shows all of the physician's patients scheduled that day + per-patient "what to ask / follow up on": **incomplete assessments, recent lab work**, med issues, and other flags. | 🟡 | **Direction CHANGED 2026-07-12:** the user **removed the Co-Pilot header tab** (`feat(copilot): remove Co-Pilot header tab` — dropped the MenuEvent/addMenuItem registration in `oe-module-copilot/Bootstrap.php`), so UC-1's *planned home no longer exists*. The floating per-patient widget is now the ONLY co-pilot surface. `public/index.php` is left orphaned (still URL-reachable, auth-gated) as a possible substrate but nothing links to it. **If UC-1 is pursued it needs a NEW entry point** (a fresh menu tab, or a launch from the widget) — decide first. **Seed ✅** — today's appts + the two-week panel (`seed_two_week_panel.php`: 16 patients, vitals/labs, appts across 14 days, live on A + B). **Remaining:** entry-point decision, `getTodaySchedule` tool, **schedule-scoped token** (carries the *set* of today's pids — extends the one-pid contract in `.claude/rules/authorization-and-pid-scope.md`; bridge computes the schedule from `openemr_postcalendar_events`), a per-patient cited brief, and the overview UI. Spec not yet written. Not graded (physician enhancement). |
| **Reduce response latency** — grounded answers are slow (eval p50 ~7.5s / p95 ~13.7s, grounding-on) | 🟡 | **User-requested 2026-07-11. Partial progress 2026-07-12 (deployed to A+B):** (a) grounding judge now judges claims in **bounded-concurrency parallel** (`checkGrounding`, verdict-identical, `docs/specs/grounding-parallel.md`) — helps multi-claim turns; (d) **Langfuse flush moved OFF the response critical path** (`docs/specs/`… chat route fire-and-forget) — removes a per-turn round-trip and immunizes response time from tracer slowness (also killed a ~9s dead-local-Langfuse stall). Also fixed a latency-inflating bug: the dosage-in-evidence fix removed ~3s/turn of grounding regeneration on med questions. **Remaining levers:** the big one is (b) **Redis Patient Snapshot cache** (also the load-test fix) to cut the FHIR fan-out on repeat turns; plus (c) **prompt caching** (0% cache hit today) and a conditional/skip grounding judge for templated factual turns. Not graded; quality/UX. |

## Current focus order
*(Reconciled against git 2026-07-10: former items 1 and 2 are done — tracker had not
recorded `c7f5479`, `630341a`, `5515b20`, `f4d2137`.)*

*(E7 done 2026-07-10 → **all engineering requirements E1–E9 are 🟢**.)*

**Session 2026-07-12 (quality/correctness pass, deployed to A+B at `1a46b7f`):** parallel
grounding judge; **dosage-in-evidence fix** (med doses were being dropped by the grounding
judge — a real correctness bug + ~3s/turn latency); **gather-history fix** (multi-turn
follow-ups like "when did she get her flu shot" degraded because the gather step read data
from prior assistant answers); **patient-age answering** (derived from DOB as a grounded
fact); **Co-Pilot header tab removed** (widget-only); **Langfuse flush off the response
critical path** + **Langfuse healthcheck fix**. All red→green tested. **Submission status:
every graded requirement is 🟢 with its saved artifact verified on disk; the only open
items are the user-produced Demo video (🔴) and Social post (🔴).**

1. **Deploy is DONE — now blue/green two-site** (Site A + Site B, memory `two-site-deploy`; deploy from `main` to the *staging* site, never the one being graded — confirm which with the user). Both live, `/ready` green. Feature work since the last tracker sync landed on `main` + on B: floating widget, response formatting, med dosage/dates, vitals+labs tools, **agentic tool-calling** (safety-core + LLM-selected optional tools, `docs/specs/agentic-tool-calling.md`).
   - **⏰ REMINDER (user asked, 2026-07-10): do the load-test hardening.** The 50-concurrent cliff was OpenEMR FHIR saturation. NOTE the agentic-tool-calling change now fetches only the safety core (4) + whatever the LLM gathers, *reducing* the per-turn FHIR fan-out vs the old always-5 — re-measure before assuming the old cliff. Bigger lever still: (a) **Redis Patient Snapshot cache** (`ARCHITECTURE.md §3`, not built) collapses the core reads → 1; (b) per-tool isolation *already done* (E4). Then **re-run E9 load → refresh `loadtest/results/`**. Quality/iteration, not graded.
2. **Daily-overview view (UC-1)** in the existing **Co-Pilot header tab** (user direction 2026-07-11: repurpose the full-page `index.php` from a patient switcher into the day's overview — no toggling; shows today's patients + per-patient "what to ask": incomplete assessments, recent labs, flags). Biggest remaining feature. Path: spec → schedule-scoped token → `getTodaySchedule` → per-patient cited brief → overview UI. *Needs a user decision:* extending the one-pid-per-session rule to a today's-pid *set*.
3. **Reduce response latency** (user-requested 2026-07-11) — grounded p95 ~13.7s. Levers: selective/parallel grounding judge, Redis snapshot cache (also the load-test fix), prompt caching (0% today), earlier streaming. Quality/UX, not graded.
4. Demo video + social post (user-produced).

**Ownership-refusal coverage (clarified 2026-07-12):** the ownership gate itself is
unit-tested (`PanelServiceTest::testRefusesAPidNotOnThePanel`, pid 3 → null → no token
minted) and the agent-level scope guarantee is eval-tested (injection-no-leak). The
promptfoo eval can't add an HTTP mint-refusal case because `dev-mint` bypasses ownership
by design. The only untested slice is the PHP controller's 403 wiring over real HTTP
(needs an authenticated OpenEMR session the headless eval lacks) — a harness limitation,
not an untested control.

## Early Submission Feedback (2026-07-11)

Reviewer feedback on the Early build was strongly positive ("genuinely production-shaped…
excellent submission overall") — the two-layer verification (deterministic citation check
→ Haiku grounding judge), identity-layer authorization, committed eval results, rigorous
Langfuse-measured cost analysis, and the load-test root-cause writeup were all called out
as strengths. Three actionable asks, with a proposed plan for each. **All three are
enhancement/polish for the *final* submission — none is a defect.** Nothing here is graded
per the rubric tracker above; this is reviewer-requested product improvement.

> **STATUS (2026-07-11): Asks 1–3 all delivered.** Ask 1 = walkthrough script written
> (user produces the video). **Ask 2 (floating widget) = BUILT + LIVE on Site B** — clinician-
> gated docked widget, patient name in header, auto-bound to the open chart (no switcher),
> clears on patient switch, launcher only inside a chart, verdict badge removed, plain-text
> formatting; `oe-module-copilot/public/widget.php` injected via `RenderEvent::EVENT_BODY_RENDER_POST`;
> spec `docs/specs/floating-agent.md`. **Ask 3 (suggested prompts) = BUILT** (curated static
> chips in the widget). Went beyond the asks: chart-data coverage (vitals/labs/dosage/dates),
> **agentic tool-calling**, and response-formatting polish. Detail in JOURNAL 2026-07-11 +
> memory `slice-status`.

### Ask 1 — Eval walkthrough in the demo *(effort: S · no code)*
The reviewer didn't see an eval walkthrough in the presentation and wants one in the final
demo. The suite + committed results already exist (`evals/promptfooconfig.yaml`,
`evals/results/`), so this is demo *content*, not new machinery.

**Plan:** prepare a tight walkthrough segment + a runnable script:
- Run `pnpm eval` live (or show the saved `evals/results/eval-results.md`), narrating the
  7 cases mapped to UC + failure-mode, and the `[safety]` subset that must be 100%.
- Show one failure mode deliberately (e.g. the injection/authz case) to demonstrate the
  gate, and the grounding-judge dropping an over-claim.
- Deliverable ✅ **written** (kept out-of-repo, local only):
  `C:\dev\temporary\openemr\docs\eval-walkthrough.md` — steps + talking points + exact
  commands (`pnpm eval` / `pnpm eval:safety`), the 7-case table, and the two moments to
  land (the injection refusal; a `—` verdict being the gate working, not a miss).
  *(User produces the video from this script.)*

### Ask 2 — Floating, patient-scoped docked agent *(effort: L · the core enhancement)*
Wire the co-pilot **into the OpenEMR patient chart itself** as a floating widget docked
bottom-right, auto-bound to the **currently-open patient** — no explicit patient selection
inside the co-pilot. Today `oe-module-copilot/public/index.php` is a full-page chat with a
manual patient **switcher**; the ask is to remove the switcher and bind to page context.

**Architecture fit (important):** this *strengthens* the locked model, it doesn't bend it.
The pid comes from OpenEMR's authenticated patient context (what the physician is already
viewing) and is still ownership-gated at mint by `SessionTokenController` /
`PanelService` (`authorization-and-pid-scope`). The footprint stays a *thin PHP module*
(chat panel + identity bridge), consistent with `ARCHITECTURE.md §2.1`. The switcher was a
v1 stopgap; this replaces it with the more natural, safer source of the pid. Complementary
to — not a replacement for — the UC-1 daily-overview (panel/morning-huddle) surface.

**Plan (three sub-parts, each with an unknown to resolve first):**
1. **Page injection.** Register a listener in the module's `Bootstrap.php` that injects the
   widget's JS/CSS onto patient-chart pages (OpenEMR event system — e.g. a render/header
   event). *Unknown to resolve:* the correct hook, and OpenEMR's frameset (patient pages
   are framed) so the widget docks at the top level, not inside a frame.
2. **Patient-context binding.** Read the current pid client-side from OpenEMR's patient
   context (session `pid` / a page-exposed global) and mint against it automatically.
   *Unknown:* the reliable client-side source of the active pid on chart pages. The mint
   endpoint already ownership-checks, so no new authz surface — just a different pid source.
3. **Docked UI.** A collapsed launcher bottom-right that expands to the chat panel; reuse
   the existing chat/token logic from `index.php`, restyled. Pairs naturally with the
   deferred **conversational-response** work (warmer formatting) for the assistant feel.

**Risks / notes:** OpenEMR's frameset + module-injection mechanics are the main unknowns
(needs a short spike). Requires a **redeploy** to go live (held until after grading). Keep
`index.php` as a fallback full-page view during the transition.

### Ask 3 — Proactive suggested prompts *(effort: S–M)*
Before the physician even opens the chat, surface quick-action suggestions
("Patient summary", "Active medications", "Allergies & contraindications",
"What changed since last visit"). Rides on Ask 2's widget.

**Plan:** render a small set of suggestion chips in the docked widget's initial state; a
click sends that prompt through the normal (gated) `/chat` flow. Start with a **curated,
UC-mapped static set** (safe, deterministic); optionally pre-fetch a one-line patient
summary on open for instant value. No change to the safety gate — suggestions are just
canned user prompts.

### Proposed sequencing
Ask 1 is independent and cheap → do anytime. Asks 2 + 3 ship together (3 rides on 2's
widget) and need a redeploy, so they land in the **post-grading redeploy pass** alongside
the load-test hardening and the final-agent redeploy. A short **spike on the OpenEMR
injection hook + client-side pid source** should precede committing to Ask 2's full build.

**Decisions needed from the user before building Ask 2/3:** (a) go/no-go on the
floating-widget direction (vs. keeping the full-page `index.php`); (b) whether suggestions
are static-curated (recommended) or dynamically generated; (c) timing — bundle with the
post-grading redeploy, or start the spike now.
