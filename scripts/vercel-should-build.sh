#!/usr/bin/env bash
# Vercel Ignored Build Step — exit 0 = skip build, exit 1 = build.
#
# Policy:
# - Auto-build production (main) only.
# - Skip preview/PR deployments (use Vercel → Redeploy when you need a preview).
# - Honor [skip deploy] in commit messages on main for docs/WIP pushes.
#
# Does not rely on the Vercel dashboard "system environment variables" toggle;
# falls back to git when VERCEL_* vars are unavailable.

set -euo pipefail

commit_message="${VERCEL_GIT_COMMIT_MESSAGE:-}"
if [ -z "$commit_message" ]; then
  commit_message="$(git log -1 --pretty=%B 2>/dev/null || true)"
fi

if echo "$commit_message" | grep -q '\[skip deploy\]'; then
  echo "Skipping: commit message contains [skip deploy]"
  exit 0
fi

branch="${VERCEL_GIT_COMMIT_REF:-}"
if [ -z "$branch" ]; then
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
fi

if [ "${VERCEL_ENV:-}" = "production" ] || [ "$branch" = "main" ]; then
  echo "Building deployment (VERCEL_ENV=${VERCEL_ENV:-unset}, branch=${branch:-unset})"
  exit 1
fi

echo "Skipping non-production deployment (VERCEL_ENV=${VERCEL_ENV:-unset}, branch=${branch:-unset})"
exit 0
