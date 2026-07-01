#!/usr/bin/env bash
#
# setup-worktree-hook.sh
#
# Installs a `post-checkout` git hook that auto-links `.env.local` into every
# newly-created git worktree. Worktrees live nested under .claude/worktrees/ and
# resolve the main repo's node_modules automatically, but Next.js loads env vars
# from the *worktree root* — which a fresh worktree lacks — so sign-in fails
# until `.env.local` is present. This hook fixes that once and for all.
#
# Run once per machine (or after a fresh clone):
#   bash scripts/setup-worktree-hook.sh
#
# The hook is stored in the shared git dir (this machine only); re-run this
# script to reinstall it elsewhere.
#
set -euo pipefail

hooks_dir="$(git rev-parse --git-common-dir)/hooks"
mkdir -p "$hooks_dir"
hook="$hooks_dir/post-checkout"

if [ -e "$hook" ] && ! grep -q 'auto-link .env.local' "$hook" 2>/dev/null; then
  echo "Refusing to overwrite an existing, unrelated post-checkout hook:"
  echo "  $hook"
  echo "Merge the logic from this script manually instead."
  exit 1
fi

cat > "$hook" <<'HOOK'
#!/usr/bin/env bash
# auto-link .env.local into newly-created git worktrees.
# Next.js loads env from the project root and worktrees don't inherit the main
# checkout's .env.local. Git ignores this hook's exit status, so it never blocks
# a checkout.

# Only run on branch checkouts (worktree add / branch switch), not file checkouts.
[ "${3:-0}" = "1" ] || exit 0

worktree_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
common_dir="$(git rev-parse --git-common-dir 2>/dev/null)" || exit 0
case "$common_dir" in
  /*) main_git="$common_dir" ;;
  *)  main_git="$worktree_root/$common_dir" ;;
esac
main_root="$(cd "$(dirname "$main_git")" 2>/dev/null && pwd)" || exit 0

# Nothing to do in the main checkout itself.
[ "$worktree_root" = "$main_root" ] && exit 0

if [ ! -e "$worktree_root/.env.local" ] && [ -f "$main_root/.env.local" ]; then
  ln -sfn "$main_root/.env.local" "$worktree_root/.env.local"
  echo "[post-checkout] linked .env.local into $(basename "$worktree_root")"
fi
exit 0
HOOK

chmod +x "$hook"
echo "Installed post-checkout hook at:"
echo "  $hook"
