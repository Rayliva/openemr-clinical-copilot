# Copilot sidecar — cheat sheet

Running list of gotchas and how-tos for the `copilot/` sidecar. Add to it whenever
something non-obvious comes up.

## Slash commands / skills only load from the right directory

The sidecar's slash commands (`/bootstrap`, `/prd`, `/tech-interview`,
`/scaffold-skills`, `/scaffold-rules`, `/pick-loop`, `/build`) and its skills live
under `copilot/.claude/`. Claude Code only discovers them when its **working
directory is `copilot/`**.

- **To use them:** start Claude Code with `copilot/` as the working directory
  (open the `copilot/` folder, or `cd copilot` before launching).
- From the **repo root**, those commands do **not** appear — you'd get OpenEMR's
  root tooling instead.
- Which `CLAUDE.md` applies follows the same rule: under `copilot/` → the sidecar's
  `CLAUDE.md`; elsewhere → the repo-root `CLAUDE.md` (the OpenEMR monolith).
