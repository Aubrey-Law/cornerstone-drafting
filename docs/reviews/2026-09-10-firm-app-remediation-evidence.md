# Firm app remediation execution evidence

Status: reliability, communications retirement, paged working lists, portal progress/history, and secondary calendar loading are prepared in an isolated worktree and published as four draft PRs. Live baseline captured after owner sign-in. The two additive migrations have now been applied with explicit owner approval; see the CI remediation entry below. Production acceptance remains open. No app deployment, queue activation, provider cutover, or external send was performed.

## Revision and environment

- Base: `03e284d0`, reconciled with newer design-sheet persistence work at execution start.
- Branch: `codex/firm-app-remediation`; checkout: `/tmp/cornerstone-remediation`.
- Original checkout preserved, including the owner's untracked plan documents.
- Supported Node 24.14.0 used for clean installation and verification. The shell's default Node 26 is outside repository engines.
- Clean baseline: lint passed with 17 warnings; typecheck passed; 464 test files passed, 4,968 tests passed and one skipped.
- Build/test credentials are synthetic. Unit tests no longer load `.env.local`; integration runs require an explicit loopback database. Build CI rejects local dotenv files and excludes inherited application credentials.

## Implemented scope

| Plan area | Source changes and evidence | Remaining gate |
| --- | --- | --- |
| R1 | Root build runs Next production build; CI builds; isolated unit/integration environment helpers; seven environment tests | Final CI on published branch |
| R2 | Document refresh retains data and separates folder/document errors; stale matter responses discarded; task failures propagate; dashboard task sections show retry | Authenticated failure/retry walkthrough |
| R3 | Shared paged accounting loader used by invoices, portal, Today, sidebar and reminder preparation; posted credits/debits and payments agree; required read failures remain errors | Database-backed accounting fixture parity |
| R4 | Typed references plus legacy adapter; missing identity throws instead of returning input; route lookup boundaries return 404; DB errors propagate | Full live legacy-reference acceptance |
| P2 | Same-request admin auth reuse; Tasks reuses request claims; independent matter reads overlap; inactive documents/history deferred; portal unread summary remains available | Live before/after timing and complete secondary server-section split |
| P3 | Tasks and matter pages/board columns, SQL lead aggregates, paged invoices/ledger, bounded matter and payment search | Production query plans and before/after acceptance |
| P4 | Concurrent sidebar categories, explicit unavailable counts, complete task badges, owner/day calendar snapshot behind Suspense, portal history cursor and displayed-ID acknowledgments | Live cache/partial-state walkthrough and production query plans |
| C1/C2 | Removed browser dialer, text controls/SDKs and Inbox implementation; old send/token routes return authenticated 410; portal replies retained and displayed messages marked read | Synthetic staff/client browser roundtrip; external routing verification |
| C3, partial | Direct Leads/Matters navigation, collapsed secondary Today planning, persisted estate/probate milestones and neutral other-track copy | Further matter-overview server-section separation and synthetic mobile walkthrough |
| C4 | Seven verified orphans, unused functions/dependency and outbound SMS adapters removed; inactive funding prompt moved to proposal documentation | Final combined checks |
| C5, partial | Owner explicitly retired automated SMS; appointment/Retell email retained, application SMS/opt-out sends removed | Provider routing/account changes are separate and were not performed |

## Earlier-batch verification (historical)

New tests observed failing before the corresponding primary fixes: unit environment isolation, document/task errors, invoice adjustment parity and paging, communications capability/retirement, lazy document loading, request auth reuse, and explicit matter identity. Portal-specific regressions additionally cover secure reply after historical SMS, another client's summary denial, bounded mark-read scope, history activation/retry, and retired-channel sends.

Targeted results include 100 communication UI/route tests; 63 accounting/retirement compatibility tests; 53 identity/lifecycle tests; 289 request/API/server-action auth tests; and eight portal summary/history boundary tests. These are overlapping targeted suites, not an additive total.

- Drafting corpus: **45/45 documents unchanged**.
- Workbench: **91 files, 1,270 tests passed**, including lint/typecheck through its verification script.
- Final lint: **0 errors, 10 existing warnings**; CI ceiling reduced to 10.
- Final typecheck: passed.
- Production build: passed with synthetic credentials.
- Full suite: **472 files passed; 4,976 tests passed, one skipped** (118.09 seconds).

The six generated theme CSS lines are reproducible output from the existing build's theme-generation step, not an intentional redesign.

## Remaining program work

P1 now has at least 20 valid repeated observations per priority route in an authenticated live session. These are tool-observed proxies; native performance phases and after-deployment comparisons remain open. Source changes alone do not establish the speed target.

P3 is implemented for primary Tasks, Matters, Leads summary, invoice, and ledger views. P4 calendar separation and portal history are implemented. C3's milestone adapter and secondary Today grouping are implemented. The matter overview still eagerly builds some intake/design comparison, linked notes/activity, consent, estate summary, and stage history on the server; those have not been falsely described as deferred. The older secondary Matters overview/aging summaries and some complete-data exports remain broad reads. Production EXPLAIN/index tuning and any further section split should follow the deployed traces. No indexes were added without plans.

A new disposable PostgreSQL 17 container was used for additive SQL fixtures. No existing container or linked firm database was reset. Migrations `20261123000000` and `20261124000000` were created locally, applied only to the fixture, and their new generated types extracted from the fixture. The production catalog was read only; text document matter IDs and UUID billing matter IDs were verified explicitly.

See [navigation benchmark status](2026-09-10-navigation-benchmark.md), [communications inventory](../operations/communications-retirement.md), and [editing ownership](../operations/firm-workspace-boundaries.md). Unchecked plan acceptance items remain open; this report is not a claim that the whole remediation program is complete.

## R5: prepared queue recovery and separate reminder cadence

Additive migration `20261123000000_workflow_job_leases.sql` retains legacy RPCs and introduces token-fenced, expiring claims. Created with the Supabase CLI, then allocated after verified local and remote migration history. Read-only production metadata confirmed the queue disabled and empty; no production migration or flag change was performed.

A disposable Postgres 17 fixture using the existing workflow-jobs table definition passed four integration tests: two independent connections skip locked rows, expired claims are replaced, stale workers cannot complete jobs, and exhausted/retry/privilege behavior is correct. Unit coverage also verifies the disabled fast path, bounded one-at-a-time claims, rejected completion, and independently authorized reminder preparation. The generated queue table and new RPC types were extracted from this actual fixture; the full database was not regenerated from an incomplete schema.

Deployment order: apply the additive migration, deploy compatible code, keep `durable_workflow_jobs_enabled=false`. Reminder preparation runs hourly and retains its existing weekly unique draft key; it never sends. The queue remains subject to a separate activation gate: side-effect replay safety (including annual-review task creation) and production execution evidence are not established by lease tests. Reverting the worker leaves old RPC compatibility and retained data.

## Working lists, portal, and calendar

- Tasks: server filters/counts, deterministic due/priority/created/ID ordering, completed-on filtering in firm time, separate completed pagination, and clear page scope for grouped headings. Today due-task reads and sidebar counts no longer silently stop at 500/2,000 rows. A complete task read reaching its safety ceiling fails visibly.
- Matters: server search/practice/stage/card/sort; independently paged board columns; global stage/insight counts; reviewed-upload timestamps; stable ID tie-breaks. CSV/export uses the same complete server filters with the pre-existing 2,000-row export cap and explicit truncation notice.
- Leads: intentionally global summary runs in SQL alongside existing bounded rows, including quoted pipeline and attention flags.
- Billing: default ledger returns one page and exact counts. Financial summaries stream separately; Insights retains full follow-up/goal/recent-payment work. Full summary source reads page beyond REST limits. Invoice register loads only visible invoice context and shared posted-adjustment accounting. Charge-level ledger balances retain their distinct semantics. Voided invoice due dates are ignored; paid month uses firm time. Matter choices and payment allocation support bounded server search. Page subtotals are labeled as shown charges, not whole-matter balances; duplicate-fee hints come from all charges.
- Portal: practice-specific progress uses recorded facts only; a later milestone does not infer missing earlier completions. Newest 50 messages load first; older `(created_at,id)` cursor pages reauthorize ownership. Only displayed message IDs are acknowledged; failed history/read-state updates remain retryable. Unsent attorney portal drafts survive tab unmounts.
- Today: Outlook loads in a separate server boundary; cache key includes resolved owner and firm day, with five-minute display freshness and invalidation on local calendar mutations. Availability/booking checks stay fresh. Partial or unavailable calendars never claim nothing scheduled. Collapsed planning cards mount their reads only after expansion.

Local SQL verification: **5 integration files / 14 tests passed** against synthetic data (queue leases; 601 tasks; 153 matters; 1,503 leads; 1,203 charges and 1,000 payments on one charge). This is a minimal fixture, not a full linked Supabase installation. No real client data or messages were used. Invoice tests separately verify exact pagination, issue-month scope, posted credits, and errors. Draft-preservation tests verify unsent messages and payment amount retention during asynchronous search.

## Rollout and remaining acceptance

Apply both additive migrations before deploying compatible code. Keep the queue flag disabled. Neither migration drops tables/history; service-only RPCs retain route authorization. Reverting list consumers leaves the additive functions and data intact. Do not reactivate outbound SMS or old browser token endpoints during rollback.

Before production completion: publish/review the branch, run CI, reconcile migration history/catalog again, apply migrations, deploy the reviewed revision, verify staff/client portal access with synthetic accounts, check retained callbacks, and repeat native performance measurements. External provider cancellation/number routing remains a separate decision. Live after-deployment speed improvement has not been claimed.

## Final local verification — 2026-09-10

- Full root suite: **484 files, 5,015 tests passed, one skipped** (285.61 seconds). The last canonical-route alias/search adjustment also passed 3 targeted navigation files / 4 tests.
- Root lint with `--max-warnings=10`: **0 errors, 10 existing warnings**.
- Root typecheck: passed; production `build:ci`: passed with synthetic configuration.
- Drafting corpus: **45/45 documents unchanged**.
- Workbench verify: lint/typecheck passed; **91 files / 1,270 tests passed**.
- Local database: checked-in fixture recreated in a fresh database and **5 files / 14 integration tests passed**. See [fixture instructions](../../tests/integration/fixtures/README.md). The task-created disposable container was stopped; no firm service was changed.
- Privacy-safe live baseline: 21 cycles; at least 20 valid observations per priority route. Today proxy p95 5.51 s, maximum 8.95 s. No after-deployment result is claimed.

Full bundle analysis exceeded 4 GB and 8 GB heaps; the opt-in browser-only analysis succeeded at 4 GB and confirms both retired browser phone SDKs are absent. Report sizes and limits are recorded in the navigation benchmark. The ordinary production build succeeded. No snapshots/golden documents were regenerated to hide failures.

Local implementation commits: `c2d7e789` (shared reads/Tasks), `35978c9c` (Matters/Leads), `dad863cf` (Billing), and `e2edaaf6` (Portal/Calendar), following `edb91db3`, `b3749832`, and `826133cc`. Publication and production changes have not been performed.

## Continued matter and lead loading work

The matter loader now starts shell-dependent intake, upload, estate, consent, and linked-history reads as soon as their actual dependency resolves. A delayed independent overview read no longer holds that chain back. Full design/intake comparison and history still finish before the detail client renders; this is dependency scheduling, not a claim that all secondary sections stream.

Matter and lead task badges now use two exact count-only reads instead of downloading/enriching the first 200 open tasks. Badge refresh has its own authorized, record-scoped endpoint, retains the last good value with a visible retry message on failure, and discards responses from a previous record. Fixtures cover 603 open tasks, ownership/status exclusions, duplicate relation matches, DST boundaries, rejected access, failed reads, and late responses. Upload count failures now reach the route error boundary instead of being converted to zero unreviewed uploads.

Continued final verification: **488 files / 5,032 tests passed, one skipped** (220.67 seconds); lint **0 errors / 10 existing warnings**; typecheck and the production `build:ci` passed. This includes the final malformed-lead-ID guard, which preserves a not-found response before any database read. Targeted loader/auth/badge checks also passed. The existing lead-loader fixture now mocks the count service explicitly and asserts that complete counts reach the client. No drafting code or golden output changed in this continuation.

Read-only production recheck: remote main is still `03e284d0`; latest database migration is `20261122000000`; neither new migration is applied. The durable queue remains disabled with zero jobs. The task due column is `timestamptz`, and PostgreSQL confirmed the named firm timezone at both DST boundaries. An EXPLAIN ANALYZE with a synthetic nonexistent record used existing bitmap indexes (`tasks_stage_engine_key`, `tasks_lead`), with 3.175 ms execution and no rows returned. This checks predicate/index compatibility only; it is not a populated-record or browser latency benchmark. No index or live data change was made. The count-only API contract was checked against the [Supabase select documentation](https://supabase.com/docs/reference/javascript/select); the changelog had no relevant breaking count-query change.

Publication is prepared as an ordered review series; see the [release review](2026-09-10-firm-app-release-review.md) and its four draft descriptions. Automatic approval review required explicit owner authorization to publish private repository code, so the attempted push did not execute. Only local review references were created. Shared-schema RPC checks on the queue/performance branches are expected to remain blocked while their reviewed additive functions are absent from production; do not weaken those checks or enable the queue to make CI green. Apply reviewed migrations before the corresponding consumer code goes live. Full synthetic portal walkthroughs, production release, and native before/after timings remain acceptance gates.


## Draft publication following owner authorization

The owner explicitly requested the push and draft PRs after the initial approval-review block. Published the four prepared branches and verified their draft status and ordered bases: [build safeguards #453](https://github.com/spaubrey/cornerstone-drafting/pull/453), [communications/reliability #454](https://github.com/spaubrey/cornerstone-drafting/pull/454), [disabled queue recovery #455](https://github.com/spaubrey/cornerstone-drafting/pull/455), and [performance #456](https://github.com/spaubrey/cornerstone-drafting/pull/456). GitHub checks have started; they are not reported as passed. The locally verified application revision is `428df951`; the publication-status update is documentation only. No merge, production migration, queue activation, provider change, or client send was performed.

### Failed-check remediation

All four initial Application CI runs exhausted Node 22's approximately 2 GiB heap during the Next TypeScript build step. The isolated build launcher now sets a fixed 4 GiB heap for its children while still discarding arbitrary parent Node options and application secrets. A regression test failed before the change and passes afterward; a second test retains dotenv rejection. Prerequisite-branch verification passed the production build, standalone typecheck, lint with 17 existing warnings, and 466 root files / 4,977 tests with one skipped. The targeted launcher/environment suite passes 9 tests. The fix is propagated forward without rewriting published history.

The owner separately approved applying exactly the two additive migrations. CLI preflight matched all 203 existing migration versions/names, with no remote-only entries and only `20261123000000_workflow_job_leases.sql` and `20261124000000_working_list_reads.sql` pending. Both were applied with those exact versions, without seeds, roles, or Vault updates. Post-application metadata confirms both lease columns, the expiry index, and all seven security-invoker functions: service_role can execute; anon and authenticated cannot. All five list functions executed successfully in a read-only service-role transaction. Queue remains disabled and contains zero jobs; the mutation RPCs were not invoked. Generated types were refreshed from the live schema to include lease fields on existing workflow-job return types as well as the new functions. No merge, app deployment, queue activation, provider change, or client send occurred. Updated GitHub checks remain the final verification gate for these fixes.
