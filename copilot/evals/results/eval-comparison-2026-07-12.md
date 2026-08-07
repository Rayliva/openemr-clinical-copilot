# Eval comparison — first run vs 2026-07-12

Re-ran the agent-in-the-loop eval suite (grounding-on) to compare against the original
saved run. **The original results file (`eval-results.json`, 2026-07-09) was not
overwritten** — today's run is in `eval-results-2026-07-12.json`.

| | First run (2026-07-09) | Today (2026-07-12) |
|---|---|---|
| **Cases** | 7 | 8 (+ new `grounded-age` behavioral case) |
| **Pass rate** | **7/7 = 100%** | **8/8 = 100%** |
| Safety subset | 5/5 | 5/5 |
| Latency p50 | 7.48 s | 9.51 s |
| Latency p95 | 13.69 s | 28.68 s |
| Latency avg | 7.82 s | 12.08 s |
| Concurrency | 2 | 2 |

## Read

- **No regressions.** Every original safety + behavioral case still passes after this
  session's changes (parallel judge, dosage/criticality/status evidence fixes,
  gather-history fix, age feature, Langfuse-flush move). The **new age case passes**, so
  the age feature is verified end-to-end through the real gate.
- **The latency delta is environment, not code.** Today's run was against the **local
  Windows-Docker OpenEMR** (whose FHIR endpoints measured 7–11 s per call — bind-mount
  filesystem I/O) over home wifi. The original run's environment was faster. Latency here
  is dominated by the FHIR fan-out + the three LLM round-trips, both of which are slower
  locally; it is **not** a comparable measurement of the agent's own overhead. The clean,
  environment-independent signal is the **pass rate (100% both runs)**. For a true latency
  number, measure on a droplet (datacenter network, faster disk) — see the load-test note.
- The p95 outlier (28.7 s) is a single case that hit the grounding regenerate loop on top
  of slow local FHIR + wifi jitter.

## How it was run

```
COPILOT_AGENT_URL=http://localhost:3040 \
  npx promptfoo eval -c evals/promptfooconfig.yaml -j 2 --no-cache \
  -o evals/results/eval-results-2026-07-12.json
```

Local agent: grounding judge **on** (Haiku), dev-mint on, Langfuse off. Ground truth:
Susan Underwood (pid 2), whose local FHIR id matches the suite's hardcoded id exactly.
