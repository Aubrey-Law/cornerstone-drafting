# Navigation benchmark status

Reported baseline: the owner experiences 5–10 second page changes on the live Cornerstone site, including Matters, Leads and Tasks. This is a user measurement, not an instrumented timing distribution.

Implementation base: `03e284d0` (latest main and production revision checked at execution start). Worktree: `/tmp/cornerstone-remediation`; branch: `codex/firm-app-remediation`.

The Codex browser remains on `/auth/login?redirectTo=%2Fadmin`. Authenticated live traces cannot be collected yet. No p50/p95, TTFB, bytes, or click-to-usable-content improvement has been claimed. A successful build and deferred reads do not establish that the ≤2 second warm p95 target is met.

Prepared changes remove browser phone SDK startup, overlap independent matter reads, reuse request-local admin verification, defer document/message history until activation, bound recent portal document candidates, and run sidebar categories concurrently. These are source-verified reductions in work; their live impact remains unmeasured.

Next measurement gate: sign in through the normal browser flow, record the reviewed deployed revision, then run the route sequence and at least 20 warm transitions per priority route from P1. Capture first visits separately. Do not retrieve credentials or include client content in trace artifacts. Compare only equivalent deployed builds and authorized datasets. Continue server-list/calendar refactors from the measured bottlenecks.
