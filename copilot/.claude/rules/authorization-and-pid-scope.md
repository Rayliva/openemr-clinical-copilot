# Authorization & pid scope

Authorization is enforced **above** OpenEMR, because OpenEMR's ACL is role-level,
not patient-level (`../AUDIT.md §1.1`). These rules are non-negotiable.

## The rules
- The agent operates on **exactly one `pid`** per session — the one in the
  boundary-#1 signed token `{user_id, pid, correlation_id, exp}`.
- **`pid` never comes from user or model input.** Tools take the pid from verified
  session context, not from tool arguments the LLM can set.
- Every OpenEMR read is **scoped to that pid**. No call may fan out to another
  patient, and no tool may accept an arbitrary pid.
- A request about a **non-owned** patient (not `patient_data.providerID` match) is
  **refused with a reason** — never partially answered.
- Re-verify the token signature and ownership on **every** request; a valid
  signature is not enough if `exp` passed or ownership doesn't hold.

## Why
The OAuth token to OpenEMR is system-wide (over-privileged, documented). The single
compensating control is that we only ever query the bound pid. If that leaks, the
whole authorization model is gone.

## Do / Don't
- **Do:** `getMedications(ctx)` where `ctx.pid` is from the verified token.
- **Don't:** `getMedications({ pid })` where `pid` is an LLM-supplied argument.
- **Do:** return "That patient isn't on your panel, so I can't show their record."
- **Don't:** summarize pid 3 (unassigned) because the model was asked to.
