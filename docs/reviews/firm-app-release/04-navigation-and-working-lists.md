Reduce navigation work for the firm's daily leads, matters, tasks, billing, and portal workflows. Lists now use bounded server pages and complete totals; billing reads follow the active view and use bounded matter/payment searches. Today streams its cached calendar separately and defers collapsed planning. Portal history loads in authorized cursor pages, acknowledges only displayed messages, and shows estate/probate progress from recorded facts.

Matter detail overlaps actual query dependencies and uses exact task badge counts; leads and badge refreshes use those same counts. Failed uploads no longer appear as zero pending files, and failed badge refreshes preserve the last good value with retry. Direct navigation avoids intermediary Leads/Matters routes.

Release step 4; based on `codex/firm-app-workflow-recovery`. Review the branch-relative diff. The earlier branches contain build safeguards, communications retirement, accounting/auth/identity fixes, and disabled queue preparation.

Validation: 488 root test files / 5,032 tests passed, one skipped; production build and typecheck passed; lint passed with 10 existing warnings. The series also passed 45 unchanged drafting corpus documents, 1,270 workbench tests, and 14 PostgreSQL integration checks with fixtures exceeding old row limits. The browser bundle excludes both retired phone SDKs. Live baseline has at least 20 valid observations per priority route; Today reached 8.95 seconds. These are baseline tool observations, not evidence of a deployed improvement.

Database prerequisite completed with explicit owner approval: `20261124000000_working_list_reads.sql` was applied to production after the queue migration. All five list RPCs have service-only invoker permissions and passed read-only execution checks under the service role. Keep the queue disabled. Reverting list consumers preserves the additive schema and data; never restore outbound SMS as a rollback shortcut.

Still required before production acceptance: synthetic staff/client portal walkthrough, review and CI, confirmed deployed SHA, native before/after timing, and trace-led tuning if targets remain unmet. Some server-side matter history/design comparisons and secondary overview reads remain eager; they are documented rather than claimed as deferred.

Evidence: `docs/reviews/2026-09-10-firm-app-remediation-evidence.md` and `docs/reviews/2026-09-10-navigation-benchmark.md`.
