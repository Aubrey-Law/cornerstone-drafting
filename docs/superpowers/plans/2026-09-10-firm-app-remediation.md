# Firm App Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute inline unless the owner requests delegation.

**Goal:** Make Cornerstone faster and simpler for a solo estate-planning/probate firm while correcting identified reliability issues.

**Architecture:** Refine the existing Next App Router, Supabase query layer, and shared drafting packages. Deliver focused PRs with bounded reads, request-scoped auth reuse, explicit error states, and staged communication retirement. Retain historical data and existing legal-workflow contracts.

**Tech Stack:** Existing Next.js 16, React 19, TypeScript, Supabase/Postgres, Vercel, Vitest, and shared workspace packages; no framework or provider migration.

**Spec:** [Firm app remediation design](../specs/2026-09-10-firm-app-remediation-design.md).

## Global Constraints

- Preserve secure portal messaging, unread state, transactional email, document sharing, and client access boundaries.
- Preserve drafting payloads, legal choices, document provenance, attorney review, and the latest design-sheet persistence work.
- Keep attorney/admin as the only active firm roles; this program does not enable staff access.
- Preserve historical communications, consent/opt-out state, stored classifications, and migration history; no destructive data migrations.
- Keep filters, sorting, counts, pagination, and board totals accurate across the complete authorized dataset.
- Do not represent a failed read as an empty list, zero balance, or completed work.
- Keep durable jobs disabled until recovery, fencing, idempotency, and execution limits pass verification and activation is explicitly authorized.
- Keep the existing main-only deployment policy; add a production build to CI instead of enabling automatic preview deployments.
- Do not send messages, transfer phone numbers, cancel providers, or change live routing as part of code preparation.

## Delivery sequence

Each numbered item is a reviewable change, not a commitment to a specific number of days. Keep a task open until its acceptance evidence is recorded. Performance work starts early; low-value cleanup must not delay it.

| Order | Deliverable | Task | Dependency and release gate |
|---|---|---|---|
| 1 | Reconcile baseline; honest build and isolated tests | [R1](2026-09-10-firm-app-reliability.md#r1-build-and-test-boundaries) | Latest main, clean install, production build succeeds |
| 2 | Measure navigation | [P1](2026-09-10-firm-app-performance.md#p1-repeatable-navigation-evidence) | Authenticated baseline before route refactors |
| 3 | Correct misleading empty states | [R2](2026-09-10-firm-app-reliability.md#r2-read-failures-and-refresh-state) | Failure/retry/switch-record tests |
| 4 | Unify invoice balances | [R3](2026-09-10-firm-app-reliability.md#r3-one-invoice-balance-read-model) | Cross-surface adjustment parity |
| 5 | Shorten navigation critical paths | [P2](2026-09-10-firm-app-performance.md#p2-request-auth-and-page-critical-paths) | P1, R2; measured improvement and auth checks |
| 6 | Remove phone/text/inbox UI; retain portal workflow | [C1–C2](2026-09-10-firm-app-simplification.md#c1-explicit-communication-capabilities) | Portal reply and dependent transport inventory |
| 7 | Explicit matter identity | [R4](2026-09-10-firm-app-reliability.md#r4-canonical-matter-resolution) | Legacy-reference and drafting regression checks |
| 8 | Bounded working lists and summaries | [P3](2026-09-10-firm-app-performance.md#p3-server-driven-working-lists) | R2/R3; page/filter/board completeness |
| 9 | Defer secondary calendar, badge, and portal reads | [P4](2026-09-10-firm-app-performance.md#p4-secondary-reads-and-database-tuning) | P1; stale/error states and portal boundaries |
| 10 | Simplify navigation and practice-area portal | [C3](2026-09-10-firm-app-simplification.md#c3-daily-workspace-and-portal-progress) | C2 and working-list contracts |
| 11 | Delete verified unused code | [C4](2026-09-10-firm-app-simplification.md#c4-proven-unused-code-and-documentation) | Can land sooner independently after R1 |
| 12 | Recoverable jobs and separate reminder preparation | [R5](2026-09-10-firm-app-reliability.md#r5-durable-job-recovery-and-reminder-cadence) | R3; additive DB/worker compatibility; stays disabled |
| 13 | Finish transport retirement | [C5](2026-09-10-firm-app-simplification.md#c5-provider-cutover-and-secondary-product-decisions) | Verified provider/reminder cutover; not a blocker for other releases |

## Start-of-execution checklist

- [x] Record `git status --short`, `git rev-parse HEAD`, current remote main, and the current production deployment SHA. Preserve unrelated work. Reconcile the three known newer production commits and anything merged since this plan.
- [x] Use a `codex/` branch or isolated worktree for implementation. Do not roll back the newer design-sheet persistence, Word export, or signed-date fixes to match the audit snapshot.
- [x] Run `npm ci` and the R1 verification cycle. Capture fresh results instead of inheriting the historical test counts in the spec.
- [x] Create `docs/reviews/2026-09-10-firm-app-remediation-evidence.md` to record revision, task, commands, results, measurement method, and remaining gates. Record metadata and synthetic examples only; no client text or credentials.

## Release discipline

For every source change, run its targeted behavioral tests, then `npm run lint`, `npm run typecheck`, and `npm test`. Run the root production build for each release. Retain CI corpus/workbench checks; run them locally when shared rendering, design identity, native dependencies, or workspace code changes. Do not regenerate golden outputs simply to make a regression green.

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run corpus:check
npm run -w apps/workbench verify
```

The last two commands are required for drafting/shared-package changes and remain existing CI checks. R1 makes `npm run build` a real build; before R1 lands, use `npm run build:next`.

Database changes use new additive migrations with unique timestamps after checking current migration history; never modify an applied migration. Reconcile local/remote history and live catalog before applying. Test against a local or designated test database, regenerate types using the repository's established workflow, then run RPC/column/type checks against the explicitly selected target. Never reset the linked firm database.

Each PR must state the user-visible change, targeted evidence, full-check results, rollout ordering, and rollback. A revert must preserve data compatibility. Auth/error-state fixes need a forward fix if reverting would restore a known unsafe behavior. Queue changes retain both old/new RPC compatibility until the worker transition is verified; communication rollback never silently reenables outbound sending or changes provider routing.

## Completion evidence

- [ ] Authenticated before/after warm and first-visit measurements for Today, Leads, Matters, Tasks, and matter detail; p50/p95, errors, and usable-content timing recorded. Target warm p95 ≤2 seconds and pending feedback ≤200 ms. If not met, identify the remaining measured bottleneck and continue performance work; do not mark performance complete from a smaller bundle alone.
- [ ] Initial failure, background refresh failure, retry, record switch, true empty state, and partial-section failures are visibly distinct.
- [ ] Invoice, Today, sidebar, portal, and reminder preparation agree on supported payment/adjustment fixtures and authorized scope.
- [ ] No phone/SMS controls or softphone requests on normal admin navigation. A portal client can send a message; the attorney sees unread work, opens the correct matter, replies, and the client sees that reply. Run send tests with synthetic local/test accounts only.
- [ ] List totals and rows remain correct beyond one page; an overdue task outside the initial page is still discoverable and counted. Probate portal copy uses actual milestones and no automatic completion promise.
- [ ] Production revision matches the reviewed release, CI is green, the disabled queue remains disabled unless separately activated, and historical documents/communications remain accessible to authorized users.

## Coverage and limits

R1–R5 cover the confirmed reliability/configuration defects. P1–P4 cover the navigation and query opportunities. C1–C5 cover calling/text/inbox removal, streamlined UX, probate progress, unused code, scheduling inventory, and editing ownership. No previously fixed Office Online preview or missing-CI work is reopened. Campaign data cleanup, a new payment processor, a new scheduling provider, workbench deletion, and renderer replacement are not bundled into this program.

Implementation is in progress. See [execution evidence](../../reviews/2026-09-10-firm-app-remediation-evidence.md) for verified changes and remaining acceptance gates. Unchecked items are not represented as completed.
