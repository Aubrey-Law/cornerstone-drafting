# Firm app remediation design

Date: September 10, 2026. Status: proposed implementation design, prepared at the owner's request. No application change or provider cutover is authorized by this document alone.

## Product scope

Cornerstone serves a solo estate-planning and probate firm. Preserve leads, matters, tasks, billing, drafting, documents, and the client portal. The owner reports 5–10 second navigation on the live website and has selected external calling/texting while retaining secure portal messaging.

The intended result is a faster daily workspace with fewer competing surfaces, reliable error states and balances, and less unused code. Deliver small, independently releasable changes. A framework rewrite, renderer replacement, hosting migration, and database upgrade are outside scope.

## Required invariants

- Preserve secure portal messaging, unread state, transactional email, document sharing, and client access boundaries.
- Preserve drafting payloads, legal choices, document provenance, attorney review, and the latest design-sheet persistence work.
- Keep attorney/admin as the only active firm roles; this program does not enable staff access.
- Preserve historical communications, consent/opt-out state, stored classifications, and migration history; no destructive data migrations.
- Keep filters, sorting, counts, pagination, and board totals accurate across the complete authorized dataset.
- Do not represent a failed read as an empty list, zero balance, or completed work.
- Keep durable jobs disabled until recovery, fencing, idempotency, and execution limits pass verification and activation is explicitly authorized.
- Keep the existing main-only deployment policy; add a production build to CI instead of enabling automatic preview deployments.
- Do not send messages, transfer phone numbers, cancel providers, or change live routing as part of code preparation.

## Evidence as of this review

Local checkout: `e0aa30c2`. Production: `03e284d08f58f1a23994b97be699a4907b041935`, three commits ahead. The reviewed navigation/query paths were unchanged between them. Start implementation from current main after reconciliation; retain newer signed-date, Word export, and design-sheet persistence changes.

Verified code issues: document/task read errors become empty arrays; balance calculations disagree about posted adjustments; unresolved matter references can be returned as canonical IDs; `npm run build` uses a timestamp shortcut and does not build Next; unit setup loads `.env.local`; communications provider parsing falls back to Twilio for invalid values; the durable queue lacks stale-running recovery and guarded completion. Seven apparently unused modules and one direct dependency were identified by static import and exported-symbol searches.

Verified performance opportunities: sequential matter reads, duplicate authentication paths, eager inactive-tab requests, broad task/matter/billing reads, an unbounded lead summary, and Today waiting for external calendar work. These are not measured contributions to the reported delay. The available browser had no authenticated session.

Live read-only observations: 101 matter records, 104 intake records, 1,512 tasks, and 327 open firm tasks. Categories overlap. Sampled historical database statement means were approximately 17–32 ms, excluding network/auth/rendering. Vercel `iad1` and Supabase `us-east-1` are aligned. Durable jobs were disabled with no rows. None of this proves the cause of an individual slow navigation.

Review baseline on local checkout: lint 0 errors/17 warnings; typecheck passed; root tests 4,924 passed, 1 skipped, 1 failed. The date-dependent stage-history assertion is already changed in the newer production revision; that fix was inspected, not rerun. A fresh production build, workbench verification, and corpus check were not run for the read-only review.

## Required outcomes

1. Reliable task/document loading, consistent adjustment-aware invoice balances, explicit matter resolution, and truthful build/test configuration.
2. Measured improvement to Leads, Matters, Tasks, and matter detail. Working target: warm navigation p95 at or below 2 seconds to usable primary content and pending feedback within 200 ms. These are acceptance targets, not existing results or a promise before measurement. Report cold starts separately.
3. Remove manual phone/SMS and the unified inbox while maintaining a complete portal reply workflow. Retire application SMS delivery, including automated appointment/receptionist paths, per the owner clarification.
4. Working lists as direct Leads/Matters destinations; Today as the daily action queue; simpler matter overview; practice-area-specific portal progress without invented deadlines or turnaround promises.
5. Delete verified unused code and unsupported-adapter documentation; retain native rendering dependencies and shared package implementations.
6. Repair the dormant job system and separate invoice reminder preparation from queue polling, without enabling automated sending.

## Deliberately gated decisions

Owner clarification during implementation: retire automated SMS too, including appointment reminders and receptionist SMS alerts. Keep email reminders, secure portal messages, historical communications, and consent state. External calling/texting happens outside Cornerstone. No live phone-number, routing, provider-account, or database changes are part of this code release.

Custom scheduling consolidation requires an inventory of active `/book`, Calendly, and Outlook entry points and an owner decision on the authority. No active booking URL will be removed on an assumption. Workbench retirement, billing system replacement, renderer replacement, and campaign-table cleanup remain separate decisions. Preserve current functionality until those decisions exist.

## Coverage and delivery

The [master plan](../plans/2026-09-10-firm-app-remediation.md) maps every outcome to concrete tasks and release gates. Its three subsystem plans can be reviewed independently. Plan creation is complete when the documents are internally consistent; implementation is complete only when the release checklist is evidenced against deployed revisions.
