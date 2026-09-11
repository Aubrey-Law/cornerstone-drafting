# Firm app production verification

Verified September 10, 2026, local Eastern time (September 11 UTC). This records the deployed release, distinct from the two new follow-up fixes below.

## Release and database

The owner merged PRs #453–#456. Main and the primary production deployment both resolve to `30a191b76c7f97c1504767d73d3c8ba8f612f903`. Vercel deployment `dpl_44seYUTiaQz2Tn2sjh8xELgQ7ZM4` was READY and carried the `cornerstone.aubreylegal.com` alias. [Application CI](https://github.com/spaubrey/cornerstone-drafting/actions/runs/34556096463), migration drift, and database schema checks passed for main.

The linked database reports latest migration `20261124000000`; the workflow queue remains disabled with zero jobs. No new production migration, queue activation, provider change, or real client message was performed during this verification.

## Navigation sample

One signed-in staff session in the Codex in-app browser on the local macOS host, normal network, no artificial throttling. Twenty-one repeated cycles followed Tasks → Leads → Matters → one fixed matter detail → Billing → Today. The intermediate CRM and matter overview pages are no longer needed for normal sidebar navigation. All 126 primary readiness checks succeeded.

| Route | Samples | p50 | p95 | Maximum | Over 2 seconds |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tasks | 21 | 0.410 s | 0.994 s | 1.361 s | 0 |
| Leads | 21 | 0.438 s | 0.823 s | 1.213 s | 0 |
| Matters | 21 | 0.431 s | 1.541 s | 2.557 s | 1 |
| Matter detail | 21 | 0.617 s | 4.948 s | 6.407 s | 2 |
| Billing | 21 | 0.543 s | 1.713 s | 3.103 s | 1 |
| Today | 21 | 0.714 s | 1.701 s | 2.991 s | 1 |

Nearest-rank quantiles. [Raw cycles](2026-09-10-navigation-post-release.json) contain timing and route labels only. Each row is one cycle in the recorded route order.

These are **tool-observed click-to-visible-control proxies**, not browser-native navigation or server timings. A fresh accessibility tree identifies each link; timing starts immediately before the AX click, followed by repeated 250-ms visible-control waits. Readiness targets are New task, New lead, New matter, the matter Overview tab, Log payment, and Today Do this next. Optional sections are excluded. Five calibration cycles using Playwright clicks were excluded because its navigation wait introduced different overhead. Local tests/build activity can affect measurements.

The [earlier baseline](2026-09-10-navigation-benchmark.md) used a different click/wait method and included intermediate overview pages. These samples do **not** support a percentage improvement claim. Native User Timing was inaccessible in the browser tool's read-only evaluation scope (`performance` was undefined), so TTFB, pending-feedback latency, bytes, scripting, and server phases remain unmeasured. No cold-cache claim is made.

Matter detail remains the observed slow outlier. It awaits multiple database/history/design reads; this inspection does not identify which phase caused the two slow samples. The ≤2-second warm p95 acceptance gate remains open. Next performance work needs request-phase evidence on that route before changing more query or drafting behavior.

## Read-only workflow checks

- Simplified sidebar and matter header rendered without the retired Inbox or manual phone/text controls. External telephone links remain external communications.
- Tasks showed separate Mine, Team, and Unassigned totals. Selecting Unassigned displayed 330 matching open tasks across seven pages; Next reached page 2 with the same total.
- Matters showed 39 matching records and 38 open matters. The board rendered Intake, Drafting, Client work, Signing, and Closed columns with matching stage totals.
- Leads displayed open/all summaries; a synthetic nonmatching search produced an empty result. The search was cleared afterward.
- Billing ledger rendered its bounded working list. Invoices loaded filter controls and a true empty result for the selected month. Insights content rendered. The Add charge dialog opened with bounded matter search and was cancelled without saving.
- A matter's Overview controls and the Drafting hub/table loaded. No draft generation or legal-data edit was performed.

Synthetic staff/client portal message roundtrip, authenticated failure/retry browser checks, mobile layout verification, and native timing remain open acceptance work. Existing automated tests are not represented as completion of those browser checks.

## Follow-up fixes

### Migration deployment automation — PR #458

Production deployment automation failed during `supabase link` because the pinned CLI tried to reveal project API keys, a capability the migration token did not have. The database-read checks were already passing with that token. The workflow now uses explicit `db push --project-ref --skip-vault`, preserves the production/main write gate, and adds a safe manual dry run. Twelve workflow contract tests passed.

The actual GitHub-credential [dry run](https://github.com/spaubrey/cornerstone-drafting/actions/runs/34557447683) succeeded: preflight and strict migration-history verification passed; Apply was skipped. No token rotation or privilege expansion was needed. [Draft PR #458](https://github.com/spaubrey/cornerstone-drafting/pull/458) is independent from the Outlook fix.

### Outlook secondary calendar reads

Production runtime logs for the verified deployment recorded `Application is over its MailboxConcurrency limit`; Today showed a partial-calendar warning. The reader previously launched up to 15 extra calendars simultaneously and checked its six-second budget only before starting each calendar. Pagination and active requests could exceed that budget.

The follow-up limits secondary reads to two concurrent workers, preserving mailbox order and primary-calendar results. Every secondary page receives the remaining shared deadline as an abort timeout; queued work stops after expiry. Partial errors continue to report skipped calendars. [Microsoft documents a four-request per app/mailbox concurrency limit](https://learn.microsoft.com/en-us/graph/throttling-limits#outlook-service-limits). This local bound leaves some capacity for other work but is not a distributed mailbox-wide semaphore; overlapping instances can still be throttled.

Regression tests cover bounded concurrency, deterministic result order, page deadlines, stalled-request aborts, queued-calendar expiry, and preserving primary results. The first two new tests failed against the original implementation and passed after the fix. This code is not yet deployed, so no live improvement from it is claimed. It needs no database migration; rollback is a code revert, retaining the existing partial-calendar warning contract.

Local validation used Node 24: lint passed with ten existing warnings; typecheck passed; the full root suite passed 489 files and 5,036 tests with one skipped. After adding the final abort/queued-work regression, the focused calendar/Today suites passed all ten tests. `npm run build:ci` completed successfully with synthetic credentials. The initial sandbox attempt could not create the build tool's local IPC socket; the permitted rerun completed. CI retains the corpus and workbench gates.
