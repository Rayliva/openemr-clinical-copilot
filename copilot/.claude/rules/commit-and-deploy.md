# Commit & deploy

Process guardrails. GitLab is the single source of truth
(`gitlab-source-of-truth` memory); a human gates anything touching the **live
environment** (deploys). Commits + pushes are **autonomous** at green boundaries
(`ask-before-commit-push-deploy` memory).

## The rules
- **Commit + push autonomously at green boundaries; ASK before every deploy.**
  (Updated 2026-07-14 by the user — was "ask before every commit/push".) Once a
  coherent increment is green (tests pass), commit and push to `main` **without
  asking**; the pre-push eval-gate hook guards every push (`w2-eval-gate`). **Deploy
  stays gated** — ask before every deploy to a live site, and **never deploy to the
  graded/frozen site** (`two-site-deploy`). Commit at natural boundaries; don't batch
  unrelated changes into one commit.
- **Conventional Commits**: `<type>(<scope>): <description>` (types: feat, fix,
  docs, style, refactor, perf, test, build, ci, chore, revert).
- Add an **`Assisted-by: Claude Code`** trailer when the AI helped write the commit.
- **Deploy only committed + pushed files.** No deploying from a dirty tree; no
  scattered untracked/generated files in the repo (keep them out or gitignore them).
- **The eval-gate git hook is the regression gate** (Week 2; `w2-eval-gate`,
  `w2-ci-runner-plan`) — it runs on every push. Deploys remain manual + operator-driven
  (`deploy-do` skill).
- Note disposable DO artifacts for teardown at project end (`deploy-cleanup`).

## Why
The user wants momentum on routine version control — commit + push are cheap and
reversible, and the pre-push gate catches regressions — but a human decision on the
**live environment**, because a bad deploy hits the graded demo (and Site B is the
frozen graded build). Clean history + reproducible deploys still depend on committing
real artifacts only.

## Do / Don't
- **Do:** commit + push a green increment autonomously —
  `git commit --trailer "Assisted-by: Claude Code" -m "feat(...)"` then `git push`.
- **Don't:** deploy to a live site without asking; **never** deploy to the
  graded/frozen site.
- **Do:** commit at natural boundaries with Conventional Commits messages.
- **Don't:** push a dirty/half-broken tree — push at green (the hook blocks a
  regression anyway).
