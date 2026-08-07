---
name: deploy-do
description: Deploy the Docker Compose stack (openemr, mysql, redis, agent, langfuse, Caddy) to the DigitalOcean VM. Use for any deploy, redeploy, or DO infrastructure change. Ask the user before every deploy and deploy only committed files.
---

# Skill: deploy-do

## When to use
Deploying the stack to the DigitalOcean VM. Same Compose project MVP→final
(`../ARCHITECTURE.md §8`): openemr, mysql, redis, agent, langfuse, langfuse-db,
Caddy (TLS).

## Two-site blue/green (as of 2026-07-11)
There are **two identical droplets** that alternate roles each grading cycle (full
detail + credentials in memory `two-site-deploy`):
- **Site A** — `openemr-copilot`, `root@203.0.113.10`, https://copilot.203-0-113-10.sslip.io
- **Site B** — `openemr-copilot-b`, `root@203.0.113.20`, https://copilot.203-0-113-20.sslip.io

Submit ONE site's URL to graders and **freeze it** (no deploys while grading); use the
OTHER as staging; next cycle, swap. **Confirm with the user which site to deploy to** —
never deploy to the site currently being graded. Both use the same SSH key, `/root/open-emr`
repo, `deploy/` compose dir, and **deploy from `main`**. Login on both: `physician` /
`<demo-password — in memory two-site-deploy, not committed>` (clinician; the widget is clinician-gated). Each site has its OWN OAuth
client + secrets — never share those; keep everything else (procedure, compose, `.env` keys)
identical so a bug can't appear on one site but not the other.

## HARD RULE — ask first
**Always ask the user for explicit approval before committing, pushing, OR
deploying** (see memory `ask-before-commit-push-deploy`). No CI in v1 — deploys are
manual and operator-driven. Doing the prep (staging, building, writing the message)
is fine; stop and ask before the commit/push/deploy action itself.

## Steps
1. Confirm the change is committed to GitLab (**after** asking) — deploy only
   committed files (`gitlab-source-of-truth`); no scattered untracked files.
2. Ask the user before proceeding to deploy.
3. On the VM: pull + recreate. **Captured (2026-07-11 deploys):**
   - Access: `ssh -i ~/.ssh/id_ed25519_openemr_do root@<site-ip>` (the default key is NOT
     authorized; use that specific key). `<site-ip>` = A `203.0.113.10` / B `203.0.113.20`.
   - Repo: `/root/open-emr`; compose dir: `/root/open-emr/deploy`.
   - Redeploy: `cd /root/open-emr && git pull --ff-only && cd deploy && docker compose up -d --build agent`.
     Use **`--build agent`** when the agent code (`copilot/`) changed — `up` alone reuses the
     old agent image. `--wait` optional (OpenEMR healthcheck can be slow).
   - **GOTCHA — git "dubious ownership":** the openemr container chowns repo files to uid
     1000, so `git pull` as root fails with "detected dubious ownership" and **silently does
     nothing** — then `--build` rebuilds from the OLD tree. Fix once per droplet:
     `git config --global --add safe.directory /root/open-emr`. Always verify the pull landed
     (`git rev-parse --short HEAD` == pushed commit) BEFORE trusting the rebuild.
   - **VERIFY the deploy took:** after `--build`, check the agent log for `agent wired for
     /chat` (fail-closed: no line = no `/chat`), and confirm the running tree has your change.
   - **Before `up`, ensure `deploy/.env` has every var the agent reads** and that each
     is **mapped in the compose `agent.environment` block** — a var in `.env` that the
     compose doesn't map never reaches the container (this bit us: `COPILOT_METRICS_TOKEN`
     was in `.env` but unmapped → `/metrics`+`/dashboard`+`/alerts` 404'd until wired).
   - **Prod compose must NOT mask `copilot/node_modules`** (the droplet builds the agent
     in-container, so the host clone has no such dir; masking a missing path under the
     read-only `/openemr` mount fails OpenEMR start). The dev stack keeps that mask.
4. Verify: hit `/health` then `/ready` (real dependency checks: OpenEMR + Claude +
   Redis + Langfuse); confirm Caddy served TLS; check Langfuse is receiving traces.
5. Note anything to tear down later (memory `deploy-cleanup` — DO artifacts are
   disposable and cleaned up at project end).

## Common pitfalls
- **Never deploy without asking** — this is the top process rule.
- **Secrets are env-only** (HMAC bridge secret, OAuth2 private key, Anthropic key,
  Langfuse keys) — never committed, never baked into an image layer.
- Don't re-platform "temporarily" — same infra MVP→final; scale by growing the VM /
  compose, not switching hosts.
- A bad deploy hits the graded demo environment — verify `/ready`, not just a bare
  200 from `/health`.
- **Standing up a NEW site** (see memory `two-site-deploy` for the full runbook): each site
  needs its OWN OAuth client (`register.ts` against that site's URL → enable via SQL
  `is_enabled=1, client_role='system'`), seeded demo data, module row, and a **physician**
  clinician account. Copying a user between sites needs FOUR things — `users`, `users_secure`,
  phpGACL (`gacl_aro` + `gacl_groups_aro_map` → Physicians), AND a **`groups`** row
  (authorization group); missing the `groups` row → login "invalid username or password".
  The DB client binary is **`mariadb`**, not `mysql`. Failed logins trip lockouts — reset with
  `UPDATE users_secure SET login_fail_counter=0,last_login_fail=NULL` + `DELETE FROM ip_tracking`.
