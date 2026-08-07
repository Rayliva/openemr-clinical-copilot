# Spec/Plan — W2 auto-ingest on upload + in-chart review (Slice 2e-async)

> A UX iteration on the review flow (physician feedback, 2026-07-14). Three changes:
> **(1)** extraction fires **automatically when a document is uploaded** (no manual "extract");
> **(2)** a **"Review Documents" button on the patient chart** opens the review as a **modal**
> (not a separate page), with a **notification dot** when there are documents to review;
> **(3)** extracted drafts are **cached** so the modal opens instantly.
> Builds on Slices 2a–2e (the extraction backend + `review.php` renderer). Chosen approach:
> **true upload-time trigger** via a minimal OpenEMR core event + a module listener.

## Why a core event (the one architectural note)
OpenEMR dispatches **no** event on a normal document upload (`PatientDocumentEvent` is fax-only;
`Document::createDocument()` and `C_Document::upload_action` fire nothing on create). True
upload-time triggering therefore needs a dispatch added to core. A background poller is the
alternative but fits poorly: **the agent has no DB access by design** (`agent ↛ MariaDB`
isolation, `ARCHITECTURE.md`), so it cannot watch the `documents` table, and a PHP cron is more
moving parts than a dispatch. **Decision (user-approved):** add a minimal, upstreamable
`DocumentCreatedEvent` to core and keep all ingestion *logic* in the module/agent — the core
footprint is a 2-line dispatch, not clinical logic, so the thin-module principle holds in spirit.

## Architecture (end to end)
```
front desk uploads a PDF
      │  (OpenEMR core)
      ▼
Document::createDocument() succeeds ── dispatch DocumentCreatedEvent(doc)   ← NEW core dispatch
      │  (module listener, Bootstrap.php)
      ▼
CopilotIngestOnUploadListener:
   - filter: PDF + a review-relevant category, has a pid          (cheap; ignore everything else)
   - server-side mint a pid-bound token (SessionTokenMinter + bridge secret)   ← system mint, not a user request
   - fire-and-forget POST {agent}/documents/extract  (short timeout; never blocks the upload)
      │  (agent)
      ▼
POST /documents/extract  → 202 immediately, then in the background:
   detect pending docs for the pid → ingestLabDocument each → CACHE the draft in Redis
      ┊
physician opens the chart (widget.php)
      ├─ GET {agent}/documents/status  → { total, ready }   (detect-only, no VLM; cheap)  → notification dot + count
      └─ clicks "Review Documents"  → MODAL → POST /documents/pending → cached drafts (instant) → render page image + boxes + table
```

## Components

### 1. Core — `DocumentCreatedEvent` + dispatch (monolith, minimal)
- **New** `src/Events/PatientDocuments/DocumentCreatedEvent.php` — a Symfony `Event` carrying the
  created `Document` (or its `{id, foreign_id(pid), category_id, mimetype, name}`). Modeled on the
  existing `PatientDocument*Event` classes; a real, upstreamable seam.
- **Dispatch** once in `Document::createDocument()` on success (after the row + uuid exist), guarded
  so it is a no-op when no kernel/dispatcher is available (CLI paths, early boot). Governed by the
  **repo-root** standards (PHP 8.2, PHPStan L10, PSR) — must pass `php -l`, phpcs, phpstan.
- **Blast radius note:** `createDocument()` runs for *every* document creation (UI upload, API,
  CCDA, portal, and CLI seeds). The event fires broadly; **the listener does all filtering** and is
  cheap + resilient. (Alternative considered: dispatch only in `C_Document::upload_action` for a
  narrower UI-only scope — flagged as an open question for the reviewer.)

### 2. Module — the upload listener (`oe-module-copilot`)
- Register `CopilotIngestOnUploadListener` on `DocumentCreatedEvent` in `Bootstrap.php`
  (`subscribeToEvents`, like the widget's render listener).
- On fire: return immediately unless the doc is a **PDF** in a **review-relevant category** and has a
  numeric `pid`. Then **server-side mint** a pid-bound session token via `SessionTokenMinter` (the
  module already holds the bridge secret) — this is a **trusted system trigger**, not a user request,
  so it deliberately does **not** run the user-ownership controller (`PanelService`); the token stays
  pid-bound so the agent still only ever touches that one patient (`authorization-and-pid-scope`).
- **Fire-and-forget** `POST {COPILOT_AGENT_URL}/documents/extract` with the token and a **very short
  timeout** (e.g. 300 ms), swallowing timeouts — the upload response must never wait on extraction.
- Resilient: agent down / any error → log, never break the upload (`error-handling-and-logging`).
- **Do not** trigger in CLI (the seed script calls `createDocument` — guard on `php_sapi_name`).

### 3. Agent — caching + endpoints
- **Redis draft cache** (agent's own Redis, in-boundary): key `copilot:ingest:draft:<documentId>` →
  the serialized `LabIngestionDraft` (incl. page image + results). **TTL** (e.g. 7 days) to bound
  growth. PHI lives in-boundary only (`phi-and-secrets`); documented. A pure cache-port is injected
  so the logic is offline-testable (fake cache in tests).
- **`POST /documents/extract`** (patient token, fail-closed like `/chat`): returns **202 Accepted**
  immediately, then extracts the pid's pending docs and caches each draft. Called by the upload
  trigger. Idempotent — a documentId already cached is skipped (extract-once, `w2-document-ingestion-writes`).
- **`GET /documents/status`** (patient token): **detect-only, no VLM** — returns
  `{ total, ready, extracting }` (pending DocumentReferences; how many have cached drafts). Cheap;
  drives the notification dot. 
- **`POST /documents/pending`** (existing; patient token): now **cache-aware** — returns cached drafts
  instantly, extracting + caching only on a miss. Called by the modal.
- All three: patient comes from the signed token, never the body; PHI-safe errors; correlation id.

### 4. Chart UI — button + dot + modal (`oe-module-copilot`)
- On chart-open, the widget (or a small new injected script) calls `GET /documents/status`; if
  `total > 0`, render a **"Review Documents" button** with a **notification dot** (+ count).
- Clicking opens a **modal overlay** (top-document, roomy — not the chat column) that calls
  `POST /documents/pending` and renders the **page image with bounding boxes + the values table**
  (reuse the `review.php` render logic; factor the JS so it is shared, not duplicated). Instant on a
  cache hit; a spinner + poll if extraction is still running.
- Modal is dismissible; read-only (the confirm→write path is the separate Slice 2f). `review.php`
  stays as a standalone fallback.

## Auth summary (two distinct mint paths)
- **User path (dot + modal):** physician session → `session-token.php` → **ownership-checked** mint
  (`PanelService`) → agent. Unchanged.
- **System path (upload trigger):** module event listener → `SessionTokenMinter` direct mint for the
  uploaded doc's pid (no user, no ownership controller) → agent. New; justified because it is a
  system reaction to an upload, and the token is still strictly pid-bound.

## Boundaries (what this slice does NOT do)
- **No chart write / no commit** — still read-only review; the physician-confirm → FHIR-write path is
  Slice 2f.
- **No intake-form path** — lab_pdf only (reuses `ingestLabDocument`).
- **No new OAuth scopes** — reuses the read-only doc scopes from 2c.
- **No cache eviction on commit** — there is no commit yet; drafts expire by TTL.

## Acceptance criteria
- **Upload trigger:** uploading a lab PDF for a patient (front-desk Documents flow) results, within
  a few seconds, in a **cached draft** for that document — with **no physician action** — verifiable
  by `GET /documents/status` showing `ready ≥ 1`. The upload HTTP response is **not** delayed by the
  ~20s extraction (fire-and-forget).
- **Core dispatch:** `DocumentCreatedEvent` fires on a normal UI upload and carries the pid + doc id;
  a CLI `createDocument` does not attempt an agent call. Core change passes php-l + phpcs + phpstan L10.
- **Dot:** opening a chart with an un-reviewed document shows the "Review Documents" button with a dot;
  a chart with none shows no dot (or no button).
- **Modal:** clicking opens the modal and renders the page image + boxes + values **from cache**
  (instant when pre-extracted); read-only.
- **Caching:** a second `POST /documents/pending` for the same doc does **not** re-run the VLM (cache
  hit); the cache is keyed by documentId and TTL-bounded.
- **Auth:** the system mint is pid-bound; the agent never touches another patient; all endpoints
  reject a missing/invalid token; PHI-safe errors.
- **Resilience:** agent down at upload time → the upload still succeeds; the physician can still open
  the modal later (extract-on-miss).
- Tests: agent unit tests (cache hit/miss, status detect-only, extract 202 + caches, gating);
  the pure cache logic offline; the core event + listener at least `php -l`/phpcs/phpstan clean.

## Plan-review resolutions (2026-07-14, plan-reviewer: BUILD-WITH-CHANGES) — build these in

**Build sequence (verify each before the next):**
- **A — agent, no monolith change (offline-testable):** Redis draft cache + injected cache port;
  cache-aware `/documents/pending` with the **cache check pushed into the per-doc loop** (not a route
  wrapper) + an **in-flight Redis lock** (`SET NX copilot:ingest:lock:<docId>`, short TTL) that both
  `/extract` and `/pending` check so concurrent callers **coalesce** instead of double-extracting;
  detect-only `GET /documents/status` (`{ total, ready, extracting }`, `extracting` derived from the
  lock). This is the foundation and is fully stubbed-testable.
- **B — chart UI, no monolith change:** the "Review Documents" button + notification dot (from
  `/status`) + the modal (reads cached `/pending`), reusing `review.php`'s renderer as **shared JS**
  (not an iframe). **A+B deliver the entire UX via extract-on-miss — no core change, no system mint.**
- **C — the true upload trigger (the only monolith change), built LAST behind the hardening below.**

**Blocker fixes (mandatory for C):**
- **Typed, confined system token.** The upload-trigger mint carries a **`subject` claim**
  (`system:ingest` vs the user path's `user:<id>`). The agent verifier reads it and **only accepts
  `system:ingest` at `/documents/extract`** — it is **rejected at `/chat` and `/pending`** (so a
  leaked/forged system token can't be replayed to read answers or drafts). TTL **seconds** (used once,
  server-to-server). The system read is written to the agent's **disclosure log attributed to the
  system principal** + correlation id (`phi-and-secrets`). This makes the ownership carve-out explicit
  and typed rather than an invisible relaxation of `authorization-and-pid-scope`.
- **Source-tagged event + listener allowlist.** `DocumentCreatedEvent` carries an explicit
  **source/context** (`upload` | `api` | `portal` | `ccda` | `cli`) set by the caller; the listener
  **allowlists only `upload`**. Do **not** infer intent from `php_sapi_name` (API/portal/CCDA are all
  web-SAPI — the CLI guard alone lets a CCD import fan out into a burst of extractions). Dispatch from
  core `createDocument()` **after commit, never inside a transaction/bulk-import loop**.

**Other required changes:**
- **`/extract` is server-to-server only** — **no CORS**, not exposed to the browser origin,
  `system:ingest`-token-only. `/status` + `/pending` remain the browser-facing pair (mirror `chat.ts`
  CORS).
- **Cache TTL = hours, not days** (e.g. 6h) — minimum-necessary PHI-at-rest; never serialize a draft
  into a log; the agent's Redis is not shared with any non-PHI use.
- **Fire-and-forget hardening:** a 300 ms `curl` still *blocks* up to 300 ms (PHP has no true async) —
  use a **socket write-and-close / very short connect timeout**; a missed trigger silently degrades to
  the modal's extract-on-miss (**an explicit acceptance test must cover the degraded path**).
- **`/status` is audit-amplified** (every chart-open = a `DocumentReference` search, and every OpenEMR
  read is audit-amplified) — add a **short per-pid `/status` cache** or lazy-load on button
  interaction, so merely opening a chart doesn't hammer OpenEMR.

**Confirmed sound (do not over-correct):** the read-only posture (no chart write anywhere); pid
provenance from `Document.foreign_id`, never user/model input; retrieval stays ownership-gated (the
modal mints through the user ownership path, so a rogue upload's cached PHI is **not retrievable** by
an attacker — the system mint is a cost/PHI-footprint vector, not an exfil one); the 3-endpoint split
(right, once the in-flight lock exists).

**Scope decision:** C (the core change) is genuinely optional for the graded demo — A+B are the real
win. It is IN scope per the user's explicit choice of the true upload-time trigger, but is built and
verified strictly last, so a problem there never blocks the shipping UX.
