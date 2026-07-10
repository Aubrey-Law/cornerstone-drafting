#!/usr/bin/env bash
# Vercel Ignored Build Step — exit 0 = skip build, exit 1 = build.
#
# Policy:
# - Auto-build production (main) only.
# - Skip preview/PR deployments (use Vercel → Redeploy when you need a preview).
# - Honor [skip deploy] in commit messages on main for docs/WIP pushes.

set -euo pipefail

if echo "${VERCEL_GIT_COMMIT_MESSAGE:-}" | grep -q '\[skip deploy\]'; then
  echo "Skipping: commit message contains [skip deploy]"
  exit 0
fi

if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "Building production deployment"
  exit 1
fi

echo "Skipping non-production deployment (VERCEL_ENV=${VERCEL_ENV:-unknown})"
exit 0
