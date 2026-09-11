# Firm App Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the reported live navigation delay while preserving complete and correct working data.

**Architecture:** Measure authenticated transitions, shorten server dependencies, defer inactive data, and use server-filtered pages plus aggregates. Keep auth and caches scoped to the authorized request/user.

**Tech Stack:** Existing Next.js App Router, React, Supabase, Sentry instrumentation, and Vitest.

**Spec:** [Firm app remediation design](../specs/2026-09-10-firm-app-remediation-design.md).

## Global Constraints

All nine invariants in the spec apply. In particular:
- Keep filters, sorting, counts, pagination, and board totals accurate across the complete authorized dataset.
- Do not represent a failed read as an empty list, zero balance, or completed work.
- Keep attorney/admin as the only active firm roles; this program does not enable staff access.
- Preserve secure portal messaging, unread state, transactional email, document sharing, and client access boundaries.

## P1: Repeatable navigation evidence

**Create:** `docs/reviews/2026-09-10-navigation-benchmark.md`, `lib/performance/navigationTiming.ts`. **Modify only where spans are missing:** `lib/apiAuth.ts`, `app/admin/matters/[id]/page.tsx`, `app/admin/leads/page.tsx`, `app/admin/tasks/page.tsx`, `app/admin/components/AdminSidebar.tsx`. Reuse `instrumentation.ts` and `instrumentation-client.ts`; preserve the existing privacy behavior and `tests/sentry-instrumentation.test.ts`. Do not add a second telemetry SDK.

**Interfaces:** Timing labels are route templates and named phases (`auth`, `role`, `primary-data`, `secondary-data`, `content-ready`), never client names, raw URLs/IDs, messages, tokens, or request bodies. Store browser timings locally for repeatable comparison; use existing sampled server spans for attribution.

- [ ] Establish a normal authenticated live session through the user's sign-in flow. If unavailable, continue synthetic local profiling and independent R/C tasks, but leave live validation open. Never retrieve browser credentials or request passwords in chat.
- [ ] Record browser/device/network, deployment SHA, cache state, and route sequence. Measure Today → Leads → lead detail → Matters → matter detail → Tasks → Billing → Today. Run at least 20 repeat transitions per priority route; record first visits separately, p50/p95 click-to-usable-content, pending feedback, response bytes, request count, TTFB, server phases, scripting, and errors.
- [ ] Add marks around the actual navigation and primary-content readiness, not only component mount or spinner visibility. Keep optional sections out of the ready definition but include rows and controls necessary for the task. A cached page still counts only when its data/state is usable.

  ```ts
  performance.mark('firm-navigation:start')
  // Place completion at the visible primary-content boundary.
  performance.mark('firm-navigation:ready')
  performance.measure('firm-navigation',
    'firm-navigation:start', 'firm-navigation:ready')
  ```

- [ ] Capture request overlap and inspect which remote calls precede visible content. Build a root-app production bundle report with `npm run build:analyze`; measure phone SDK and inactive pane contributions rather than guessing their sizes. Do not enable session replay containing client content.
- [ ] Rank fixes by measured time saved and frequency. Record evidence in the benchmark file. Run lint/typecheck/build for instrumentation and verify logs contain no client data. Commit as `perf: establish navigation timing evidence`.

## P2: Request auth and page critical paths

**Modify:** `lib/apiAuth.ts`, `lib/supabaseServer.ts`, `proxy.ts` only if needed for shared contracts, `app/admin/tasks/page.tsx`, `app/admin/leads/[id]/page.tsx`, `app/admin/matters/[id]/page.tsx`, `app/admin/matters/[id]/MatterDetailClient.tsx`, `app/admin/matters/[id]/useMatterDocuments.ts`, `app/admin/matters/[id]/useMatterCommunications.ts`, and the corresponding route `loading.tsx` files. **Create:** `tests/request-auth-reuse.test.ts`, `tests/matter-secondary-loading.test.tsx`. **Extend:** `tests/api-route-auth.test.ts`, `tests/server-action-auth.test.ts`, `tests/matter-detail-lead-access.test.ts`.

**Interfaces:** Preserve the existing `requireAdmin` result/callers, bearer-token handling, and request-cached claims/role helpers. Reuse verification within the same request, not a process-global authorization cache. Document/document-folder hooks gain an `enabled: boolean` input and explicit initial/refresh/error state from R2; communications history follows the same activation contract. Unread summaries remain independently available.

- [ ] Test missing/expired credentials, bearer auth, attorney/admin, client denied from firm routes, role change behavior, and same-request repeated authorization. Confirm the actual signing mode before treating `getClaims()` as network-free; fix the overly broad comment. Preserve a reliable role-freshness path for privileged operations.
- [ ] Test that opening Overview makes no detailed document/folder/message-history request, activating a tab fetches once, reopening can reuse current matter data, and switching matters clears prior data. A rejected tab read offers retry. Keep pending edits/message draft state when switching tabs.
- [ ] Run new tests before changes. Consolidate only redundant verification that the chosen runtime can actually reuse; the proxy and route are separate execution boundaries and must not be assumed to share React cache. Keep route authorization even if the proxy checked the session.
- [ ] Restructure matter loading around canonical identity/access followed by truly independent requests. Start required overview queries together; move activity, full intake comparisons, documents, messages, and marketing details behind their section boundary. Use count queries for counts instead of full task histories. Preserve current recent design-sheet persistence logic.

  ```tsx
  // Pass pending work into separate server boundaries; do not await all
  // secondary data before constructing this tree.
  <Suspense fallback={<SectionPending />}>
    <SecondarySection />
  </Suspense>
  ```

  Use the existing skeleton components in the actual implementation; the snippet illustrates where the pending work belongs, not a request for a new UI library.

- [ ] Add immediate route pending states to affected transitions; they supplement shorter data waits. Correct any hard navigation to internal links found in the trace using the existing Next navigation pattern.
- [ ] Run `npx vitest run tests/request-auth-reuse.test.ts tests/matter-secondary-loading.test.tsx tests/api-route-auth.test.ts tests/server-action-auth.test.ts tests/matter-detail-lead-access.test.ts`, master checks, and P1 before/after measurements. Commit as `perf: shorten authorized page loading paths`.

## P3: Server-driven working lists

Deliver four successive reviewable slices: Tasks, Matters, lead summaries, Billing. Each slice has its own test/implementation/check/commit cycle; do not land partially migrated callers.

**Modify:** `lib/queries/tasks.ts`, `app/admin/tasks/page.tsx`, `app/admin/tasks/TasksClient.tsx`; `lib/queries/matters.ts`, `lib/queries/matterDashboard.ts`, `app/admin/matters/MattersClient.tsx`; `lib/queries/leadList.ts`, `app/admin/leads/page.tsx`; `lib/queries/billing.ts`, `lib/queries/invoices.ts`, `app/admin/billing/page.tsx`, `components/billing/InvoiceListTable.tsx`. **Create:** `lib/queries/page.ts`, `tests/working-list-pagination.test.ts`, `tests/billing-query-scope.test.ts`, and additive aggregate/page migrations only when required. **Extend:** `tests/task-read-completeness.test.ts`, `tests/task-effective-due-parity.test.ts`, `tests/lead-list-params.test.ts`, `tests/lead-board.test.ts`, `tests/matter-stage-totals.test.ts`, `tests/invoice-metrics.test.ts`.

**Interfaces:** Put only the shared page envelope in `lib/queries/page.ts`. Domain filters and allowlisted sorts stay in their query modules; use existing row types. Add paginated entry points rather than breaking complete-data callers such as exports.

```ts
export type PageRequest = { page: number; pageSize: number }
export type PageResult<T> = {
  rows: T[]
  page: number
  pageSize: number
  total: number
}
// page is 1-based; default size 50, maximum 100. Validate finite integers.
// Offset = (page - 1) * pageSize; append unique ID to every sort.
```

New entry points use these contracts in their corresponding query modules:

```ts
// tasks.ts: import TaskPriority/TaskRow from lib/tasks/types.ts.
type TaskPageQuery = PageRequest &
  Omit<FetchTasksOptions, 'all' | 'limit'> & {
    priority?: TaskPriority | 'all'
    completedOn?: string // YYYY-MM-DD in the firm timezone
  }
// fetchTaskPage(query: TaskPageQuery): Promise<PageResult<TaskRow>>
// Match the existing compareTasks order; no new arbitrary sort vocabulary.

// matters.ts: use existing filters/sort from lib/adminTables/matterTable.ts.
type MatterPageQuery = PageRequest & {
  filters: MatterTableFilters
  sort: MatterSortKey
}
// fetchMatterPage(query: MatterPageQuery): Promise<PageResult<MatterListRow>>

// invoices.ts: use existing InvoiceStatus and exported InvoiceListRow.
type InvoicePageQuery = PageRequest & {
  matterId?: string
  status?: InvoiceStatus
  issueMonth?: string // YYYY-MM; use a half-open date interval
}
// fetchInvoicePage(query: InvoicePageQuery): Promise<PageResult<InvoiceListRow>>
```

Keep `fetchLeadList`'s already bounded rows; replace the broad `fetchLeadListSummary` implementation with an aggregate. Document whether each summary is global or filtered; preserve the existing intentionally global lead summary unless UI labels explicitly change. Validation rejects malformed dates/months and unknown filter values before building SQL. Related unbilled/payment views keep their own accounting-period definitions; invoice issue month must not silently become payment-received month.

- [ ] For Tasks, create >500 synthetic tasks including firm/client/automation owners, open/done, null due dates, equal sort keys, linked lead/matter records, and a due task outside page 1. Assert global counts, stable pages, effective due date order, and deduplicated task identity. Add a done-today task outside the old 200-row completed selection and query by completion date directly.
- [ ] Run Tasks tests to expose incomplete/client-filtered behavior. Implement server filtering/order/range with globally accurate totals and summaries; preserve owner default and `effective_due_at`. For board views, page each column independently with exact column totals. Keep complete exports explicitly separate. Run targeted tests and master checks; commit `perf: page tasks with complete server totals`.
- [ ] Repeat the behavioral cycle for Matters using >100 records, archived/hired filters, stage changes, search, equal names, and uploads. Fetch enrichment only for visible rows; use narrow aggregates for overview totals. Verify page reset on filter change and deterministic secondary ID sorting. Commit `perf: bound matter list reads`.
- [ ] Test lead global summary against fixtures spanning several pages and filtered rows. Compute aggregates in SQL without sending all records to JavaScript; start row and independent summary requests together. Do not regress existing exact counts, URL filters, or board semantics. Commit `perf: aggregate lead summaries on the server`.
- [ ] For Billing, test selected month boundaries in firm time, more invoices than one page, paid/overdue/unbilled tabs, posted adjustments, and authorized matter scope. Use R3 for balances; fetch the active tab/page plus aggregate totals. Change all-matter selectors to bounded server search. Preserve ledger/invoice/payment distinctions. Commit `perf: scope billing reads to active views`.
- [ ] Run `npx vitest run tests/working-list-pagination.test.ts tests/billing-query-scope.test.ts tests/task-read-completeness.test.ts tests/task-effective-due-parity.test.ts tests/lead-list-params.test.ts tests/lead-board.test.ts tests/matter-stage-totals.test.ts tests/invoice-metrics.test.ts` as the combined regression gate. For new SQL, compare local/test RPC output with reference calculations on fixtures and generated types, not only mocked responses. Record P1 timings per released slice.

Offset pagination is acceptable at current volume; preserve stable ordering and reset after relevant mutations. Adopt keyset pagination only where traces or history growth justify it, not as a prerequisite for every list.

## P4: Secondary reads and database tuning

**Modify:** `lib/queries/today.ts`, `lib/appointments/graphEvents.ts`, `app/admin/page.tsx`, `lib/queries/sidebarCounts.ts`, `lib/queries/portal.ts`, `app/(portal)/messages/MessageThread.tsx`. **Create:** `tests/today-secondary-loading.test.tsx`, `tests/portal-history-pagination.test.ts`, `tests/sidebar-count-errors.test.ts`. **Extend:** `tests/today-decision-queue.test.tsx`, `tests/portal-message-thread.test.tsx`, `tests/portal-account.test.ts`.

**Interfaces:** Calendar reads return bounded day data with `fetchedAt` and `stale` metadata; the firm day/timezone is explicit. Cache only by authorized calendar owner/day and invalidate on local appointment changes. Sidebar category errors remain distinguishable from zero; preserve its existing 30-second cache. Portal history uses `(created_at, id)` cursor ordering within authorized records.

- [ ] Test a delayed/failed external calendar while Today tasks remain usable. Stream calendar separately; initially use a five-minute server snapshot TTL with visible last-updated time and manual refresh. Keep scheduling availability checks fresh and outside this display cache. Defer collapsed planning-card fetches until expansion.
- [ ] Test independent badge failures and invalidation after task/message/billing changes. Run independent categories concurrently, replace row downloads with aggregates, and remove unified-inbox counts only after C2 supplies portal unread summaries. Do not make a secondary badge block navigation.
- [ ] Test portal history with >100 messages, tied timestamps, overlapping own/shared documents, and another client's records. Fetch newest 50 messages and page older results deterministically. Do not mark unseen older messages read merely because the thread opened. Query two candidates from each disjoint/deduplicated recent-document source, merge by document ID and timestamp, and display the latest two; if source semantics can duplicate many rows internally, deduplicate in the database before limiting.
- [ ] Run `npx vitest run tests/today-secondary-loading.test.tsx tests/portal-history-pagination.test.ts tests/sidebar-count-errors.test.ts tests/today-decision-queue.test.tsx tests/portal-message-thread.test.tsx tests/portal-account.test.ts`, master checks, and route timings. Commit separately by Today/badges/portal if changes can release independently.
- [ ] Only for measured slow database paths, inspect actual query plans and row counts on local/test fixtures, then safe read-only production evidence. Add indexes matching observed predicates/order/join keys through additive migrations; verify plan improvement and write cost. Review advisor findings individually. Do not bulk-create 135 indexes, drop 57 supposedly unused indexes, or tune RLS as a substitute for tracing service-role admin reads.

Relevant primary references: [Next parallel fetching/streaming](https://nextjs.org/docs/app/getting-started/fetching-data), [Supabase claims verification](https://supabase.com/docs/reference/javascript/auth-getclaims), and [range semantics](https://supabase.com/docs/reference/javascript/using-modifiers-range). Recheck installed-version behavior while implementing.
