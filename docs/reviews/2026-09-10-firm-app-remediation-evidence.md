# Firm app remediation execution evidence

Status: first code batch implemented in an isolated worktree; broader program and live acceptance remain open. No production deployment, database migration, provider cutover, or external send was performed.

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
| P4, partial | Concurrent sidebar categories, explicit unavailable counts, portal recent-document limits and deduplication | Calendar streaming/cache and cursor-paged portal history |
| C1/C2 | Removed browser dialer, text controls/SDKs and Inbox implementation; old send/token routes return authenticated 410; portal replies retained and displayed messages marked read | Synthetic staff/client browser roundtrip; external routing verification |
| C3, partial | Direct Leads/Matters navigation, Portal messages label, removed automatic two-week drafting promise | Practice-specific persisted milestones and overview simplification |
| C4 | Seven verified orphans, unused functions/dependency and outbound SMS adapters removed; inactive funding prompt moved to proposal documentation | Final combined checks |
| C5, partial | Owner explicitly retired automated SMS; appointment/Retell email retained, application SMS/opt-out sends removed | Provider routing/account changes are separate and were not performed |

## Behavioral verification

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

P1 remains blocked on an authenticated live browser session. Consequently measured performance acceptance is open. P3 still requires complete server-driven Tasks/Matters/Billing paging and lead aggregates with global filters/totals; do not impose arbitrary client-side caps. P4 still requires calendar separation and portal history cursors. C3's practice-specific milestone adapter and slimmer overview remain to be implemented. R5's versioned lease/fencing migration, worker budget, side-effect replay tests and separate reminder cron remain to be implemented after reconciling the future-dated migration history and test catalog; the queue is not activated by this branch.

Docker is available, but no local DB containers were running when checked. No existing container or linked firm database was reset. No migration was created/applied and generated database types were not changed in this batch.

See [navigation benchmark status](2026-09-10-navigation-benchmark.md), [communications inventory](../operations/communications-retirement.md), and [editing ownership](../operations/firm-workspace-boundaries.md). Unchecked plan acceptance items remain open; this report is not a claim that the whole remediation program is complete.
