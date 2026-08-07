#!/usr/bin/env bash
#
# Install the Week 2 eval-driven gate as a git PRE-PUSH hook. This is the authoritative regression
# gate (the assignment accepts "Git Hook or equivalent"; memory `w2-ci-runner-plan`). It runs
# copilot/scripts/eval-gate.sh on the host and blocks a push that regresses the offline eval gate.
#
# Coexists with the repo's prek pre-commit/commit-msg hooks (a separate hook file). Run once per
# clone:  bash copilot/scripts/install-git-hooks.sh
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"

# Respect a custom core.hooksPath if one is set (e.g. by another tool); otherwise .git/hooks.
HOOKS_DIR="$(git -C "$ROOT" config --get core.hooksPath || true)"
if [ -z "$HOOKS_DIR" ]; then
  HOOKS_DIR="$(git -C "$ROOT" rev-parse --git-path hooks)"
fi
case "$HOOKS_DIR" in
  /*) : ;;                        # already absolute
  *)  HOOKS_DIR="$ROOT/$HOOKS_DIR" ;;
esac
mkdir -p "$HOOKS_DIR"

HOOK="$HOOKS_DIR/pre-push"
if [ -e "$HOOK" ] && ! grep -q "eval-gate.sh" "$HOOK" 2>/dev/null; then
  echo "install-git-hooks: a pre-push hook already exists at $HOOK and is not the eval gate." >&2
  echo "                   Back it up or merge manually; not overwriting." >&2
  exit 1
fi

cat > "$HOOK" <<'EOF'
#!/usr/bin/env bash
# Week 2 eval-driven gate (installed by copilot/scripts/install-git-hooks.sh).
# Blocks a push that regresses the offline eval gate. Emergency bypass: git push --no-verify.
exec bash "$(git rev-parse --show-toplevel)/copilot/scripts/eval-gate.sh"
EOF
chmod +x "$HOOK"

echo "install-git-hooks: installed the pre-push eval gate at $HOOK"
echo "install-git-hooks: pushes now run copilot/scripts/eval-gate.sh and block on a regression."
