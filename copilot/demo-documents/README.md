# Demo documents (synthetic)

Synthetic lab-result reports and patient intake forms for the twelve patients on Dr. Donna Lee's
panel (the Week-2 ingestion demo). **Synthetic data only** — no real patients, no PHI.

Each patient has two documents, styled to match the committed fixtures
(`packages/ingestion/fixtures/w2/susan-lab-panel.html` / `susan-intake-form.html`):

- `<lastname-firstname>-lab-report.{html,pdf}` — a lab panel whose values are consistent with the
  patient's charted conditions (e.g. James Okoro / CKD-3 → eGFR 42, K⁺ 5.4; Ahmed Hassan / poorly
  controlled T2DM → A1c 10.8%; Harold Kim / hyperlipidemia → LDL 182).
- `<lastname-firstname>-intake-form.{html,pdf}` — demographics, chief concern, current meds,
  allergies (e.g. Rosa Alvarez's penicillin allergy → doxycycline, not a penicillin), family history.

## Purpose
Upload a PDF to a patient through OpenEMR's normal **Documents** flow to exercise the co-pilot's
document ingestion end to end (detect → extract → OCR box-match → review), across multiple patients
and both document types (`lab_pdf` + `intake_form`).

## Regenerate
The `.html` files are the editable source; the `.pdf`s are rendered from them (US-Letter, Playwright):

```
node copilot/demo-documents/render-demo-docs.mjs
```

Playwright is a devDependency of `@copilot/ingestion`; the render script resolves it from that
package. Review the diff before committing regenerated PDFs.
