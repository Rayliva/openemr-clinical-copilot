# deploy/ — public deployment stack

Runs **this fork's source** (OpenEMR 8.2.0-dev) on a single DigitalOcean droplet
behind a Caddy TLS edge with a real Let's Encrypt certificate.

- `docker-compose.yml` — MariaDB + OpenEMR (`flex` image building this repo) + Caddy.
  Only Caddy publishes host ports (80/443); the DB has none.
- `Caddyfile` — obtains/renews the cert for `$SITE_ADDRESS` and proxies to OpenEMR.
- `.env.example` — template for the server-only `.env` (hostname + secrets + composer token).

## How it runs the fork
The `flex` image is a "bring your own source" OpenEMR image. This compose mounts
the repo (`..`) into it; on first boot flex builds the app (composer + npm +
webpack) and self-configures the DB. That build is the price of running an
unreleased dev version — subsequent boots reuse the build volumes and are fast.

## Deploy (on the droplet)
```bash
git clone <this fork> /root/open-emr        # via read-only deploy key
cd /root/open-emr/deploy
cp .env.example .env                         # set SITE_ADDRESS + generate secrets
docker compose up -d                         # first boot builds; watch: docker compose logs -f openemr
```
Redeploy after commits: `git pull && docker compose up -d` (add `--build agent` when the
Co-Pilot source changed, so the sidecar image is rebuilt).

To stamp the build id served at the agent's `GET /version` (so the adversarial-AI security
platform auto-detects the deploy), pass the commit at `up` time:
```bash
git pull
COPILOT_VERSION=$(git -C /root/open-emr rev-parse --short HEAD) \
  docker compose up -d --build agent
```
Without `COPILOT_VERSION`, `/version` returns `"unknown"` (the container image has no `.git`).

`SITE_ADDRESS` is an `<ip>.sslip.io` hostname (gives Let's Encrypt a name to
certify without buying a domain).

## Notes
- **Secrets never go in git** — only `.env` on the droplet holds them.
- **OpenEMR's original code is untouched** — this is deployment infrastructure only.
- The first-boot build is memory-hungry; on a small droplet add swap first.
