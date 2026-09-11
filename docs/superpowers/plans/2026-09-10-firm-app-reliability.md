# Firm App Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct misleading read results, inconsistent balances, ambiguous identity, and release/worker configuration defects.

**Architecture:** Keep existing domain helpers and add focused query/state boundaries. Use additive database changes for the dormant worker, with old/new deployment compatibility.

**Tech Stack:** Existing TypeScript, Next.js, Supabase/Postgres, Vitest, and GitHub Actions.

**Spec:** [Firm app remediation design](../specs/2026-09-10-firm-app-remediation-design.md).

## Global Constraints

All nine invariants in the spec apply. In particular:
- Do not represent a failed read as an empty list, zero balance, or completed work.
- Preserve drafting payloads, legal choices, document provenance, attorney review, and the latest design-sheet persistence work.
- Keep durable jobs disabled until recovery, fencing, idempotency, and execution limits pass verification and activation is explicitly authorized.
- Keep the existing main-only deployment policy; add a production build to CI instead of enabling automatic preview deployments.

## R1: Build and test boundaries

**Modify:** `package.json`, `.github/workflows/app-ci.yml`, `tests/setup.ts`, `vitest.config.ts`, `README.md`. **Create:** `tests/integration/setup.ts`, `vitest.integration.config.ts`, `scripts/ciBuild.mjs`. The integration files own explicit real-service execution; the CI script owns build-only synthetic environment and inherits no production secrets. Move only tests that actually use real services into the integration selection; retain unit authorization tests.

**Interfaces:** `npm run build` delegates to existing `build:next`; `typecheck` remains the real compiler command. Add `test:integration` for explicitly selected local/test services. Add `build:ci` invoking `node scripts/ciBuild.mjs` with build-only synthetic values and subprocess exit-code propagation.

- [ ] Inventory real external calls in tests before changing setup. Remove both implicit `.env.local` loading and inheritance of service credentials from the unit run; set synthetic URL/keys explicitly before app modules load. Mock external clients in unit fixtures. Exclude `tests/integration/**` from root Vitest selection; select only that directory in the integration config and preserve the existing aliases. Integration setup requires an explicit `INTEGRATION_SUPABASE_URL` and matching key; reject the known production hostname `qifunlovuwaryzsyfbnh.supabase.co`. Require loopback or a separately documented test-project allowlist, not merely any hostname other than known production. Local Supabase is the default integration target.
- [ ] Replace build script with the following, preserving the existing `prebuild:next` theme hook exactly once:

  ```json
  "build": "npm run build:next",
  "build:ci": "node scripts/ciBuild.mjs",
  "test:integration": "vitest run --config vitest.integration.config.ts"
  ```

- [ ] Implement the CI script to spawn `npm run build` with synthetic build configuration and `stdio: 'inherit'`; propagate child failure. If build-time code attempts authenticated data reads, move that work to the authorized request boundary. Do not bypass validation, inject live secrets, or mask errors to make the build pass.
- [ ] Add a CI step running `npm run build:ci`; keep lint/typecheck/tests/corpus/workbench steps and main-only Vercel behavior. Refresh stale explanatory comments. Update README with distinct build/typecheck/unit/integration commands.
- [ ] Verify clean install, real `.next` production artifacts, and nonzero exit on a temporary uncommitted syntax error in an isolated checkout; undo the intentional error. Verify the unit suite runs identically without `.env.local` and with an ignored local file present. Verify integration setup rejects the production hostname before opening a connection.
- [ ] Run master release checks; commit this scope as `fix: make builds and test environments explicit` when executing. Do not duplicate the stage-history clock fix already on newer main.

## R2: Read failures and refresh state

**Modify:** `app/admin/matters/[id]/useMatterDocuments.ts`, `app/admin/matters/[id]/MatterDetailClient.tsx`, `lib/queries/tasks.ts`, `lib/queries/crmDashboard.ts`, `lib/queries/matterDashboard.ts`, `components/tasks/OpenTasksCard.tsx`; update direct task-loader consumers found by symbol search. **Create tests:** `tests/matter-document-read-state.test.tsx`, `tests/task-read-errors.test.ts`. **Extend:** `tests/task-read-completeness.test.ts`, `tests/matter-documents-tab-render.test.tsx`.

**Interfaces:** Keep successful `fetchTasks` results unchanged; throw on query failure instead of returning `[]`, including later internal pages. Document hook adds section-specific `documentsError` and `foldersError` plus truthful initial loading; existing `reload()` remains the retry entry point. UI consumers must handle rejected task reads rather than converting them back to success.

- [ ] Add failure fixtures for first task page, later task page, document-only failure, folder-only failure, refresh failure after success, and switching from matter A to B during an outstanding request. Assert unavailable state never renders “Nothing open right now.” Test the existing hook through a rendered component, not source-string matching.

  ```ts
  // Task query fixture supplies a PostgREST error through the mocked client.
  await expect(fetchTasks()).rejects.toThrow()
  // UI assertions after a failed refresh:
  expect(screen.getByText('Previously loaded document')).toBeVisible()
  expect(screen.getByRole('button', { name: /retry/i })).toBeVisible()
  expect(screen.queryByText('Nothing open right now')).toBeNull()
  ```

- [ ] Run the new tests and confirm they fail for swallowed errors before modifying behavior.
- [ ] Replace `.catch(() => [])` with explicit section state. Use independent settled results so a folder failure does not discard documents. Preserve last successful data only for the same matter ID; reset state on identity change and ignore late responses using a request-generation guard. Show initial pending state immediately.
- [ ] Make task consumers display unavailable/retry independently of other successful dashboard sections. Audit upload counts and message counters in the touched matter overview: unavailable must not become zero. Do not introduce a global cache containing another client's data.
- [ ] Run `npx vitest run tests/matter-document-read-state.test.tsx tests/task-read-errors.test.ts tests/task-read-completeness.test.ts tests/matter-documents-tab-render.test.tsx`, then master checks. Commit as `fix: distinguish failed reads from empty work`.

## R3: One invoice balance read model

**Modify:** `lib/billing/invoices.ts`, `lib/queries/invoices.ts`, `lib/queries/today.ts`, `lib/queries/sidebarCounts.ts`, `lib/queries/portal.ts`, `lib/workflowJobs.ts`. **Create:** `lib/queries/invoiceBalances.ts`, `tests/invoice-balance-parity.test.ts`. **Extend:** `tests/solo-practice-efficiency.test.ts`, `tests/invoice-metrics.test.ts`, `tests/portal-account.test.ts`, `tests/sidebar-badges.test.ts`, `tests/today-billing-card.test.tsx`.

**Interfaces:** Reuse `adjustedInvoiceBalance` and existing `InvoiceBalanceAdjustment` from `lib/billing/invoices.ts`. New `loadInvoiceBalances(admin, invoiceIds: readonly string[]): Promise<Map<string, number>>` returns integer cents for every requested existing invoice and throws on required query failure. It consumes already-authorized IDs; it grants no access. Use the repository's generated Supabase client type for `admin`. Missing invoice IDs are errors at the caller, not implied zero balances.

- [ ] Add one fixture matrix consumed by all surface tests: unpaid, partial payment, fully paid, posted credit reducing balance to zero, unposted adjustment ignored, debit/refund according to existing adjustment semantics, void/draft exclusion from collections, and credit-note behavior. Pin firm time when testing overdue status.

  ```ts
  expect(adjustedInvoiceBalance(10_000, 2_000, [])).toBe(8_000)
  // For each richer fixture, assert every displayed/reminder balance equals
  // the existing canonical helper, and compare eligibility separately.
  ```

- [ ] Run new parity tests and verify Today/sidebar/reminder fixtures expose their missing-adjustment behavior.
- [ ] Implement the shared loader with batched payments/posted-adjustment reads for authorized IDs. Bound ID batches for large callers. Reuse the existing invoice helper, credit-note rules, integer-cents arithmetic, and payment accounting; do not invent a second arithmetic formula.
- [ ] Replace Today/sidebar/reminder payment-only logic and use the same loader in invoice/portal reads. Preserve each surface's authorized scope and eligibility rules; balances are shared, while counts can intentionally represent different scopes. Fail reminder preparation if balances are unavailable. No messages are sent by this task.
- [ ] Run `npx vitest run tests/invoice-balance-parity.test.ts tests/solo-practice-efficiency.test.ts tests/invoice-metrics.test.ts tests/portal-account.test.ts tests/sidebar-badges.test.ts tests/today-billing-card.test.tsx`, then master checks. Commit as `fix: share adjustment-aware invoice balances`.

## R4: Canonical matter resolution

**Modify:** `lib/draftPayload/resolveMatterId.ts`, `lib/buildDraftPayload.ts`, `lib/draftPayload/assemble.ts`, `app/admin/matters/[id]/page.tsx`, and every caller returned by `rg -n 'resolveMatterId' app lib tests`. This includes drafting/text/DOCX, status/stage, SLA anchors, matter type, billing schedule, financial exception, quick draft, preflight, export, and clause routes. **Create:** `tests/matter-reference-resolution.test.ts`. **Extend:** `tests/matter-owned-lead-lifecycle.test.ts`, `tests/matter-status-route.test.ts`, `tests/draft-generation-route.test.ts`, `tests/sla-anchors-route.test.ts`.

**Interfaces:** Define the following in `resolveMatterId.ts`; keep the existing string adapter temporarily for legacy URLs. Database failures throw. Unresolved identity never returns the input as a valid ID.

```ts
export type MatterRef =
  | { kind: 'matter'; value: string }
  | { kind: 'number'; value: string }
  | { kind: 'design-sheet'; value: string }
  | { kind: 'intake'; value: string }
export type ResolvedMatter = { matterId: string; source: MatterRef['kind'] }
// resolveMatterRef(ref, admin): Promise<ResolvedMatter | null>
// resolveMatterId(inputId, admin): Promise<string> remains a legacy adapter;
// it throws MatterReferenceNotFoundError when all supported lookups miss.
```

- [ ] Test each supported reference, canonical hired matter in one query, unknown ID, ambiguous legacy UUID precedence matching current successful behavior, non-hired records, and a DB error in each lookup. Verify unknown references produce route 404 and query failures produce an error response, never a successful mutation against raw input.
- [ ] Run the new tests to expose unresolved fallthrough and swallowed errors.
- [ ] Implement typed resolution. Use the canonical variant when a caller already holds a canonical ID. Retain compatibility resolution only for existing external/legacy entry points, preserve hired-matter scope, and keep lead workflows separate. Do not infer reference kind solely from a UUID's shape.
- [ ] Convert all consumers to explicit error/not-found handling, retaining shared access checks. Update source-text tests where necessary and add behavioral assertions; a changed import string is not sufficient verification.
- [ ] Run `npx vitest run tests/matter-reference-resolution.test.ts tests/matter-owned-lead-lifecycle.test.ts tests/matter-status-route.test.ts tests/draft-generation-route.test.ts tests/sla-anchors-route.test.ts`, master checks, corpus and workbench verification. Commit as `fix: resolve matter references explicitly`.

## R5: Durable job recovery and reminder cadence

**Modify:** `lib/workflowJobs.ts`, `app/api/cron/workflow-jobs/route.ts`, `vercel.json`, `packages/db-types/src/supabase.generated.ts`. **Create:** `lib/billing/prepareInvoiceReminders.ts`, `app/api/cron/invoice-reminders/route.ts`, `tests/workflow-job-leases.test.ts`, `tests/invoice-reminder-preparation.test.ts`, `tests/integration/workflow-job-leases.test.ts`, and a uniquely timestamped additive migration named `<timestamp>_workflow_job_leases.sql`. Allocate the timestamp from current migration history during execution; do not edit the old claim migration.

**Interfaces:** Move `prepareInvoiceReminderDrafts()` to the billing module, using R3 balances, retaining its `{ drafted, unavailable }` result and weekly uniqueness. New versioned RPCs `claim_workflow_jobs_v2(p_limit, p_worker, p_lease_seconds)` return a claim token and expiry; `finish_workflow_job_v2(p_job_id, p_claim_token, p_error)` accepts only the current unexpired claim. Keep old RPCs until no deployed caller uses them. Worker success counts update only after guarded finish succeeds.

- [ ] In a local/test DB, write two-worker tests for exclusive claim, crash then expiry/reclaim, late finish rejected, attempts exhausted, retries/backoff, and repeat side effects. Use controllable SQL timestamps/short test leases rather than long real sleeps. Unit-test worker time budget and failures preparing reminders.

  ```sql
  -- Integration assertion pattern: a reclaimed job has a different token.
  -- Finishing with the first token must affect zero rows or return a typed
  -- stale-claim result, and must never mark the second claim complete.
  SELECT * FROM claim_workflow_jobs_v2(1, 'worker-a', 5);
  ```

- [ ] Implement additive claim token/lease state and recovery for expired running jobs. Retain attempt ceilings/backoff and mark exhausted jobs failed. Claim one job at a time; stop claiming with less than 10 seconds remaining in the route's 60-second budget. Set production lease to 120 seconds and require bounded per-job execution below the route deadline; any job needing longer execution is not eligible for activation until moved to a suitable worker.
- [ ] For each existing job kind, verify an idempotency key and transaction/unique constraint protecting its durable side effect. Fencing completion alone does not prevent a duplicate side effect. A killed worker after a committed side effect must be safely retryable. Keep the feature disabled if any job lacks this guarantee.
- [ ] Move reminder preparation to its own authenticated cron at `15 * * * *` (hourly UTC; eligibility/cadence still calculated in firm time). Remove it from queue processing only in the same release that adds the reminder cron. Preserve one draft per invoice per firm week, escalation copy, and attorney-controlled send behavior. Batch reads through R3 and surface preparation failures.
- [ ] Have the queue cron return a disabled result before claiming when the flag is false. Deploy additive schema, regenerated types, compatible worker, and schedule changes in that order. Verify reminder preparation still runs while jobs remain disabled. Do not enable the queue or remove duplicate inline paths in this release.
- [ ] Run `npx vitest run tests/workflow-job-leases.test.ts tests/invoice-reminder-preparation.test.ts` and `npm run test:integration -- tests/integration/workflow-job-leases.test.ts`, then master checks. Record schema/worker revision and rollback to the compatible old worker; preserve additive columns/RPCs. Commit as `fix: fence workflow claims and separate reminder preparation`.

Activation is a later explicit release gate: all job kinds pass replay/crash tests, no double execution from inline paths, production flag/state verified, monitoring and rollback documented. Existing disabled/empty queue state is not a current incident or a navigation bottleneck.
