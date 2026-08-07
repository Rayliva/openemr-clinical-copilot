# Load / stress test

Fires concurrent `POST /chat` requests at the **deployed** agent and records
p50/p95/p99 latency, error rate, throughput, and a per-error-class breakdown at each
concurrency level. Results + CPU/mem baselines live in `results/`.

## Run

`/chat` binds the patient by a signed boundary-#1 token and dev-mint is off in prod, so
the driver mints its own tokens with the prod bridge secret. Provide it (and the patients
to rotate) via env — **never commit the secret**:

```bash
export COPILOT_BRIDGE_SECRET=...          # prod bridge secret (from deploy/.env on the droplet)
export AGENT_URL=https://copilot.203-0-113-10.sslip.io
export RUN_ISO=2026-07-10
export PATIENTS='[{"pid":2,"fhir":"<uuid>"}, ...]'   # real, provider-owned patients on the target
# optional: export LEVELS='[{"c":10,"n":100},{"c":50,"n":100}]'
node loadtest/run.mjs
```

CPU/mem baselines were captured separately by sampling `docker stats` on the droplet for
the duration of the run:

```bash
ssh <droplet> 'for i in $(seq 1 150); do echo "T=$(date +%s)"; \
  docker stats --no-stream --format "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}"; done' > docker-stats.txt
```

## Results

See [`results/loadtest-results.md`](results/loadtest-results.md) for the analysis and the
root-cause of the 50-concurrent cliff (OpenEMR FHIR saturation, not the LLM).
