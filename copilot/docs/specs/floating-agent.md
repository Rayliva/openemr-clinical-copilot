# Spec — Floating, patient-scoped co-pilot widget (Early-feedback Ask 2)

Status: **Built + live-verified locally** (branch `feat/floating-agent`, not pushed).
Widget injects via `RenderEvent::EVENT_BODY_RENDER_POST`, binds to the open patient's pid
from `top.app_view_model…patient().pid()`, mints an ownership-checked token, chats over the
gated `/chat` SSE, and renders the safety-flag chips + verdict — all confirmed in the
running OpenEMR UI. (A full grounded answer *through the widget* pending a clean LLM-reachable
run; earlier direct turns + graceful degradation confirmed.) Needs a redeploy to ship.
Traces to Early Submission Feedback Ask 2 (see `docs/week1-requirements.md`) and USERS.md
(single-patient chart assistance). Governed by `.claude/rules/authorization-and-pid-scope.md`,
`ARCHITECTURE.md §2.1`.

## Problem

Today the co-pilot is a full-page module (`oe-module-copilot/public/index.php`) reached
from a menu, with a manual **patient switcher**. The physician has to leave their chart,
open the co-pilot, and re-select the patient they were already looking at. The reviewer
asked for the co-pilot to live *on* the patient chart as a floating, docked widget,
auto-bound to the open patient — no explicit selection.

## Behavior

- A collapsed **launcher** docks at the **bottom-right** of the OpenEMR patient chart.
  Clicking it expands a chat panel; clicking again (or an ✕) collapses it.
- The panel is **auto-bound to the currently-open patient** — the pid comes from the
  page's patient context, never a switcher and never user/model input
  (`authorization-and-pid-scope`). It is still **ownership-gated at mint** by the existing
  `SessionTokenController` / `PanelService` (unchanged authz; only the pid *source*
  changes — from a click-selection to the page context).
- On expand (before the physician types), the panel shows a small set of **proactive
  suggested prompts** (Ask 3): "Patient summary", "Active medications",
  "Allergies & contraindications", "What changed since last visit". Clicking one sends it
  through the normal, gated `/chat` flow.
- When **no patient is in context** (a non-chart page), the launcher either hides or shows
  a disabled state — it never mints a token without a bound patient.
- Switching to a different patient **resets** the bound token + conversation (a new pid =
  a new session, one bound pid per session — the rule holds).
- Reuses the existing chat/token/SSE logic and the safety-flag chips; restyled as a docked
  panel. The verification gate and `/chat` contract are **unchanged**.

## Boundaries

- **No change to the safety gate, the `/chat` contract, or the authz model.** This is a
  presentation + pid-source change. The token is still bridge-minted and ownership-checked.
- **Still a thin PHP module** (`ARCHITECTURE.md §2.1`) — chat panel + identity bridge. No
  clinical logic in PHP.
- Keep the full-page `index.php` as a **fallback** during the transition (do not delete it).
- Suggestions are **curated + static** (UC-mapped), not model-generated — deterministic,
  no new safety surface.
- Not the UC-1 daily-overview (panel/morning-huddle) — this is the single-patient,
  on-chart surface. Complementary, different spec.

## Acceptance criteria

1. On a patient chart page, a bottom-right launcher appears; expanding it shows the chat
   panel docked over the page (visible across the app, not trapped in a sub-frame).
2. With a patient open, sending a message returns a grounded answer about **that** patient
   with no manual patient selection anywhere in the widget.
3. The pid the widget mints against equals the patient currently open in OpenEMR; a request
   for any other patient is impossible from the widget UI.
4. Opening the panel shows ≥3 suggested-prompt chips; clicking one sends that exact prompt.
5. On a page with no patient in context, the widget does not mint a token / shows a
   disabled state.
6. Selecting a different patient resets the session (new token, cleared conversation).
7. A user lacking the `patients`/`demo` ACL does not get the widget (same ACL as the page).
8. The existing full-page `index.php` still works (fallback preserved).

## Resolved mechanisms (spike, 2026-07-11)

- **A1 — Injection hook: `RenderEvent::EVENT_BODY_RENDER_POST`** (`"main.body.render.post"`),
  dispatched at `interface/main/tabs/main.php:567` inside the top shell's `<body>`. A
  listener just `echo`s raw HTML/`<script>`/`<link>` — no return/filter. Content lives in
  the persistent top document and survives tab navigation. Register it in the module's
  `Bootstrap::subscribeToEvents()` with `addListener(RenderEvent::EVENT_BODY_RENDER_POST, …)`.
  Optionally add a top-navbar launcher via `EVENT_BODY_RENDER_NAV` (`main.php:519`).
  Model on the **FaxSMS softphone** (`oe-module-faxsms/.../NotificationEventListener.php:104-117`
  → echoes a Twig widget; `renderPhoneButton` on `EVENT_BODY_RENDER_NAV`). **Not**
  `ScriptFilterEvent`/`StyleFilterEvent` — those fire only from the calendar.
- **A2 — Client-side pid: `top.app_view_model.application_data.patient()?.pid()`** — a
  Knockout observable set by `left_nav.setPatient(...)` (`frame_proxies.js:27-54`), `null`
  when no chart is open (guard with `?.`). Inner pages announce pid via
  `parent.left_nav.setPatient(...)` (e.g. `demographics.php:924`). Subscribe to the
  observable (or poll) so the widget re-binds when the physician switches patients.
  Server-side truth is `$_SESSION['pid']` via `PatientSessionUtil::getPid()` (returns 0 when
  none) — usable to seed the initial value, but the client observable is authoritative as
  the user navigates.
- **A3 — Frameset: no classic frameset.** `main.php` is the top document; tabs are iframes
  in `#framesDisplay` (`main.php:524-525`). Inject at the top level (via A1) so the widget
  floats over all tabs; never inject into an inner page (it'd be trapped + destroyed on nav).
  `top.` is `main.php`.
- **A4 — Precedent:** FaxSMS RingCentral softphone (docked, toggleable, injected app-wide)
  is the closest model; the version footer (`main.php:532-534`, `position:fixed; bottom;
  inset-inline-end; z-index:4`) shows corner docking.

## Build plan (on `feat/floating-agent`; local only — no push/deploy yet)
1. **Bootstrap listener** — subscribe to `EVENT_BODY_RENDER_POST` (+ optional `_NAV`),
   gated by the `patients`/`demo` ACL, echoing the widget markup + assets.
2. **Widget** (launcher + docked panel) — a template + JS/CSS. Reads pid from A2, mints via
   the existing `session-token.php` (POST), chats via the agent `/chat` (SSE), renders the
   safety-flag chips. Hidden/disabled when `patient()` is null.
3. **Suggested prompts (Ask 3)** — curated chips in the panel's idle state.
4. Keep `index.php` as the fallback full-page view.

Ships needing a redeploy (module change) — bundle with a future deploy, not now.
