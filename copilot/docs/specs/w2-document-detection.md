# Spec — W2 document detection (Slice 2c)

> Find a patient's un-ingested source documents. The front desk uploads a PDF through
> OpenEMR's normal Documents flow (it lands as a FHIR `DocumentReference` + `Binary`); on
> chart-open the co-pilot lists the patient's `DocumentReference`s via FHIR and surfaces the ones
> not yet ingested. Traces to Core Req 1 + the PRD's settled front-desk-upload model. OAuth scopes
> `system/DocumentReference.read` + `system/Binary.read` added (Slice 2c, `register-oauth-client`).

## Split (orchestrator-only / pure)
- **Pure, in `@copilot/ingestion` (`src/detect.ts`):** `detectPendingDocuments(bundle, alreadyProcessed)`
  — parse a FHIR `DocumentReference` search `Bundle` (untrusted → Zod parse-don't-validate) into the
  pending documents (supported type, `current`, not already processed). No IO.
- **Edge (later, Slice 2d):** the FHIR `search("DocumentReference", {patient})` call
  (`openemr-client`) and the `Binary/<id>` byte fetch — injected, not in this slice.

## Behavior — `detectPendingDocuments(bundle: unknown, alreadyProcessed: ReadonlySet<string>): PendingDocument[]`
Parse the bundle's `entry[].resource` `DocumentReference`s. Emit a `PendingDocument` for each that:
- has `status === "current"` (skip `superseded` / `entered-in-error` — never re-ingest a replaced/void doc);
- has a `content[].attachment` whose `contentType` is **supported** (`application/pdf` for now) and whose
  `url` resolves a `Binary/<id>` (the byte source); and
- whose `id` is **not** in `alreadyProcessed` (idempotent surfacing — a doc already ingested/queued is not re-surfaced).

`PendingDocument = { documentId, binaryId, contentType, title, date? }`:
- `documentId` — `DocumentReference.id` (uuid), stable per document; the key for `alreadyProcessed`.
- `binaryId` — parsed from `attachment.url` (segment after `/Binary/`); what the byte fetch calls.
- `contentType`, `title` (attachment title or `""`), `date` (optional).

The **content hash** idempotency the write path needs (`w2-document-ingestion-writes`) is computed at
*commit* (Slice 2f) from the fetched bytes — detection keys on the stable `documentId`, so surfacing is
cheap and needs no byte fetch. (Same file uploaded twice = two DocumentReferences surfaced; the commit
hash-dedup no-ops the duplicate — separation of concerns.)

## Boundaries (Slice 2c does NOT do)
- **No FHIR fetch, no byte download, no VLM/OCR, no persistence** — later slices. Detection is pure over
  a supplied bundle.
- **No non-PDF types** (photographed forms) — a documented later addition to the supported set.
- The `alreadyProcessed` set is **supplied** — its persistence (agent Postgres) is a later slice.

## Acceptance criteria
- A `current` PDF DocumentReference not in `alreadyProcessed` → one `PendingDocument` with `binaryId`
  parsed from the `Binary/<id>` url, `contentType`, `title`, `date`.
- A DocumentReference whose `id` is in `alreadyProcessed` → excluded.
- A non-PDF attachment (`image/tiff`, `text/plain`) → excluded (unsupported type).
- A `superseded` / `entered-in-error` status → excluded.
- An attachment with no `Binary/<id>` url → excluded (can't be fetched).
- An empty bundle (no `entry`) → `[]`.
- A malformed bundle entry (missing required fields) is skipped, not a throw — one bad entry never drops
  the whole list (but a non-object bundle throws — a corrupt response is a fail-loud integrity error).
- Pure: no IO, deterministic.

## Open questions
- **`alreadyProcessed` source** — agent Postgres of committed/queued document ids (Slice 2d/2f). Keyed by
  `documentId` here; commit-time hash-dedup is the second layer.
- **Supported types** — `application/pdf` only for MVP; add image types when a photographed-form path lands.
