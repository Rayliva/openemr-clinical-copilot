---
description: Reload build position from disk and state the next spec item
---

Orient yourself in this project from files, not from a chat summary. The user
should not have to explain where we left off.

1. Read `docs/week1-requirements.md` — the graded-requirements tracker. Note every 🔴 and
   🟡 row and the **Current focus order** at the bottom.
2. Read `docs/JOURNAL.md` — the most recent 2–3 entries. These carry decisions and
   dead ends that the tracker cannot; do not re-litigate what is settled there.
3. Read `docs/build-loop.md` — the procedure you are about to re-enter.
4. Run `git log --oneline -10` and `git status --short` to see what actually landed
   and whether the tree is dirty.
5. Skim `docs/specs/` for any spec with unresolved **open questions**.

Do NOT read `docs/PRD.md`, `docs/tech-spec.md`, `../AUDIT.md`, or
`../ARCHITECTURE.md` up front. Rules and `USERS.md` are already loaded, and the
skills surface themselves. Pull the others in only when the selected item needs
them: `openemr-gotchas` covers most of what `AUDIT.md` is consulted for, and
`architecture-decisions` most of what `ARCHITECTURE.md` is.

Then report to the user, in under 15 lines:

- **Where we are:** the milestone, and the last thing that landed (from git + tracker).
- **Next spec item:** the single highest-priority unfinished item, per the tracker's
  focus order. One line. Name the UC or graded requirement it traces to.
- **Deployment:** the app is **blue/green across two DO droplets** (Site A + Site B,
  memory `two-site-deploy` / `deploy-do` skill) that alternate graded-vs-staging each cycle.
  State which site is currently graded vs the staging target — deploy only to staging, from
  `main`, and never to the site being graded. Confirm the current roles with the user.
- **Blockers:** anything needing a user decision — a product ambiguity, a missing
  credential or host fact behind a skill `TODO:`, or a pending commit/push/deploy
  gate. Also flag a dirty tree.
- **Uncommitted or undocumented drift:** anything in `git status` or the tracker that
  looks like work that was done but never recorded.

Stop there and await direction. Do **not** start the build loop — the user runs
`/build` when they are ready. If the tracker and git history disagree about what is
done, say so explicitly rather than picking one; that disagreement is usually a
missed `RECORD` step from the previous session.
