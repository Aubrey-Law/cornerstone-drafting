# Firm App Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove built-in calling/texting and the unified inbox, retain portal messaging, and simplify the firm's daily workspace.

**Architecture:** Separate manual communication capability from automated delivery/callbacks and historical reads. Retire UI before transports, reuse existing matter/portal workflows, and delete only verified-unused code.

**Tech Stack:** Existing Next.js/React UI, TypeScript, Supabase, communication adapters, and Vitest.

**Spec:** [Firm app remediation design](../specs/2026-09-10-firm-app-remediation-design.md).

## Global Constraints

All nine invariants in the spec apply. In particular:
- Preserve secure portal messaging, unread state, transactional email, document sharing, and client access boundaries.
- Preserve historical communications, consent/opt-out state, stored classifications, and migration history; no destructive data migrations.
- Do not send messages, transfer phone numbers, cancel providers, or change live routing as part of code preparation.
- Preserve drafting payloads, legal choices, document provenance, attorney review, and the latest design-sheet persistence work.

## C1: Explicit communication capabilities

**Modify:** `lib/communications/providers.ts`, `lib/communications/config.ts`, `lib/sms/provider.ts`, `lib/sms/transport.ts`, `app/api/admin/communications/status/route.ts`, `VERCEL_ENV_CHECKLIST.md`; manual-send routes under `app/api/admin/{leads,matters,contacts}/[id]/send-sms/route.ts` and browser voice credential endpoints discovered in the inventory. **Create:** `tests/communication-capabilities.test.ts`, `docs/operations/communications-retirement.md`. **Extend:** `tests/telnyx-communications.test.ts`, `tests/lead-sms-route.test.ts`.

**Interfaces:** Extend provider type to `'twilio' | 'telnyx' | 'none'`; undefined retains the historical Twilio default during transition, invalid nonempty values fail configuration rather than silently selecting Twilio. Add `manualCommunicationsEnabled(): boolean` from `MANUAL_COMMUNICATIONS_ENABLED`, accepting only `true`/`false` with absent value disabling manual communications. The owner subsequently retired automated SMS too. Manual capability defaults to off; all application SMS delivery is disabled regardless of legacy provider settings. Portal messages, transactional emails, and verified callbacks remain separate.

- [x] Inventory every sender, token route, directory/context route, webhook, scheduled reminder, Retell alert, phone-number/routing dependency, env variable, and SDK consumer. Record exact path, producer, remaining consumer, replacement, and cutover state in the retirement document. Include appointment reminders and `lib/retell/notify.ts`; do not infer usage only from visible buttons.
- [ ] Add tests for unset/default provider, both supported providers, `none`, typo rejection, manual disabled with transport retained, no token issuance when manual calling is disabled, and portal messages still enabled.

  ```ts
  vi.stubEnv('SMS_PROVIDER', 'none')
  expect(smsProvider()).toBe('none')
  vi.stubEnv('SMS_PROVIDER', 'twilo')
  expect(() => smsProvider()).toThrow()
  vi.stubEnv('MANUAL_COMMUNICATIONS_ENABLED', 'false')
  expect(manualCommunicationsEnabled()).toBe(false)
  ```

- [ ] Run tests to expose the current fallback. Implement strict parsing; every sender handles `none` before initializing a provider client. Gate manual APIs server-side with an explicit disabled response, not just hidden buttons. Preserve normal authentication and do not change inbound routing/callback validation.
- [x] Document the exact retirement setting `MANUAL_COMMUNICATIONS_ENABLED=false`. Automated SMS dependencies are now explicitly retired. `SMS_PROVIDER=none` is supported; retain webhook-verification and voice-routing credentials until external routing is separately verified. Expose capability booleans to the UI without secrets.
- [ ] Run `npx vitest run tests/communication-capabilities.test.ts tests/telnyx-communications.test.ts tests/lead-sms-route.test.ts`, then master checks. Commit as `feat: add explicit manual communication off switch`.

## C2: Portal workflow and removal of phone/text/inbox surfaces

**Modify:** `components/rail/AdminRail.tsx`, `app/admin/AdminLayoutClient.tsx`, `app/admin/components/AdminSidebar.tsx`, `app/admin/components/TodayQueue.tsx`, `app/admin/matters/[id]/MatterDetailClient.tsx`, `app/admin/matters/[id]/useMatterCommunications.ts`, `lib/queries/sidebarCounts.ts`, and lead/contact/header send controls identified in C1. **Delete after reference checks:** `components/softphone/Softphone.tsx`, `components/softphone/SoftphoneProvider.tsx`, `components/softphone/usePhoneDirectory.ts`, `app/admin/components/softphoneEvents.ts`, `app/admin/inbox/InboxClient.tsx`, `app/admin/inbox/loading.tsx`. **Revise:** `app/admin/inbox/page.tsx` into a redirect; remove inbox APIs/`lib/queries/inbox.ts` only after relocating any remaining portal/history reader. **Create:** `tests/communications-retirement.test.tsx`, `tests/portal-reply-workflow.test.tsx`. **Extend:** `tests/portal-message-thread.test.tsx`, `tests/matter-header-comms-actions.test.tsx`, `tests/today-decision-queue.test.tsx`.

**Interfaces:** Keep the existing portal message API, authorization, unread semantics, and Today link `/admin/matters/{id}?tab=communications` compatible. The visible tab becomes “Portal messages”; historical phone/SMS/email logs stay available in a read-only history section. Preserve the URL parameter until a separately tested redirect exists.

- [ ] Add a synthetic end-to-end workflow: client A sends, attorney sees unread summary, opens the correct matter, replies, client A reads; client B cannot read or write A's thread. Verify unread updates after read/reply and duplicate realtime events do not duplicate rows. Use local/test accounts, not live client sends.
- [ ] Add negative tests asserting no softphone mount/directory/token request during admin navigation, no manual SMS controls on leads/matters/contacts, and disabled manual endpoints cannot send when invoked directly. Preserve ordinary `tel:` links and copyable contact details for external communication.
- [ ] Run the tests before removal. Split portal live thread reads from read-only historical SMS/email readers. Remove SMS realtime subscriptions and eager SMS fetches from the normal matter mount. Keep portal unread summaries lightweight and available on Today.
- [x] Remove the phone rail/panes, composers, call controls, and standalone inbox navigation/badge. Redirect `/admin/inbox` to Today without forwarding arbitrary URLs. Preserve recognized legacy matter links only after validating the referenced authorized record.
- [x] Remove the two browser voice SDK dependencies (`@twilio/voice-sdk`, `@telnyx/webrtc`) and their lockfile entries once C1 confirms no remaining browser consumer. Retain server `twilio`/`telnyx` dependencies until C5. Keep callbacks, history rows, consent and unsubscribe state.
- [ ] Run `npx vitest run tests/communications-retirement.test.tsx tests/portal-reply-workflow.test.tsx tests/portal-message-thread.test.tsx tests/matter-header-comms-actions.test.tsx tests/today-decision-queue.test.tsx`, master checks, and the synthetic browser workflow. Compare route request counts/bundles and P1 timings. Commit as `refactor: retire phone sms and unified inbox surfaces`.

## C3: Daily workspace and portal progress

**Modify:** `app/admin/AdminLayoutClient.tsx`, `app/admin/components/AdminSidebar.tsx`, `components/GlobalSearch.tsx`, `app/admin/page.tsx`, `app/admin/components/TodayQueue.tsx`, `app/admin/crm/CrmSubnav.tsx`, `app/admin/matters/MattersSubnav.tsx`, `app/admin/matters/[id]/MatterDetailClient.tsx`, `app/(portal)/dashboard/page.tsx`, `lib/queries/portal.ts`. **Create:** `lib/portal/progress.ts`, `tests/portal-practice-progress.test.ts`, `tests/firm-navigation.test.tsx`, `docs/operations/firm-workspace-boundaries.md`. **Extend:** `tests/matter-overview-hierarchy.test.ts`, `tests/today-decision-queue.test.tsx`, `tests/portal-account.test.ts`.

**Interfaces:** Use existing lead and matter list routes as canonical working destinations after confirming the current route tree; retain `/admin/crm/opportunities` re-export compatibility with `/admin/leads`. New `portalProgress` consumes an explicit practice track and persisted milestone facts and returns a label plus completed/current/pending milestone presentation. It must not derive legal deadlines from generic date arithmetic.

```ts
// lib/portal/progress.ts: presentation types, not new stored classifications.
export type PortalTrack = 'estate-planning' | 'probate' | 'other'
export type PortalMilestone = {
  key: string
  label: string
  state: 'completed' | 'current' | 'pending'
}
export type PortalProgressInput = {
  track: PortalTrack
  milestones: readonly PortalMilestone[]
  nextAction: string | null
}
export type PortalProgress = {
  heading: string
  milestones: readonly PortalMilestone[]
  nextAction: string | null
}
// portalProgress(input: PortalProgressInput): PortalProgress
// lib/queries/portal.ts maps current stored practice/stage/milestone facts
// into this input using explicit mappings, preserving unknowns as 'other'.
```

- [ ] Test direct navigation to `/admin/leads` and `/admin/matters/list`, preserving old URLs, back button, filters, and active-nav state. Keep Today, Leads, Matters, Tasks, Billing, and Drafting primary; move Calendar, Assistant, Library, and Settings to a reachable secondary tools group. Keep contextual drafting assistance in the drafting workspace. Update the actual `adminNavItems` literal in `AdminLayoutClient.tsx`, its source-text tests, and global search destinations together.
- [ ] Reduce the matter overview to identity, stage, next action, important recorded dates, and balance. Keep People, Documents, Tasks, Billing, and Portal messages one click away. Load history, consent, and full intake/design comparisons only in secondary sections using P2 boundaries.
- [ ] Keep one underlying task across Today/Tasks/matter views. Show attorney actions for deadlines, intake/document review, portal replies, and billing exceptions from existing domain state; do not create duplicate tasks merely to populate a dashboard.
- [x] Add estate-plan, probate, other-track, missing-data, and partially completed milestone fixtures. Use existing probate essentials fields as source facts, but expose only client-appropriate milestones; do not expose internal notes or all court/deadline fields by default. Unknown track displays neutral “Your matter” and recorded stage. Estate/probate labels reflect actual workflow, and the automatic two-week promise is removed.

  ```ts
  // Fixture expectations for the pure presentation adapter:
  // probate -> no "Your estate plan" heading or automatic drafting promise
  // unknown track -> neutral matter heading; no invented completed milestones
  // recorded milestone -> completed only when persisted facts support it
  ```

- [x] Document an editing ownership map: intake facts → intake editor; drafting decisions → existing authoritative design editor; matter identity/stage → matter controls; invoices/payments → billing. Summary views link to those editors. Preserve the newer design-sheet persistence implementation; do not create a new editing surface or port code from `aubrey-law-app`.
- [ ] Run `npx vitest run tests/portal-practice-progress.test.ts tests/firm-navigation.test.tsx tests/matter-overview-hierarchy.test.ts tests/today-decision-queue.test.tsx tests/portal-account.test.ts`, master checks, and a keyboard/mobile browser pass using synthetic estate/probate matters. Commit navigation and portal changes separately if reviewable independently.

## C4: Proven unused code and documentation

**Delete after refreshed consumer checks:**

- `lib/payments/lawpay.ts`
- `lib/estateGenerator/runtime.ts`
- `lib/drafting/docxMarkerPatterns.ts`
- `lib/documentSource.ts`
- `lib/matterPlanType.ts`
- `lib/designSheet/fiduciaryContactDetails.ts`
- `lib/designSheet/initialTrusteeNomination.ts`

**Modify:** `package.json`, `package-lock.json`, `next.config.mjs`, `VERCEL_ENV_CHECKLIST.md`, `.github/workflows/app-ci.yml`, `lib/appointments/graphBusy.ts`, `lib/draftPayload/fiduciaryDetails.ts`, `packages/drafting-engine/src/docxTrackedChanges.ts`, `packages/drafting-engine/src/estateGenerator/draftDocumentName.ts`, `app/api/admin/matters/[id]/design-sheet/apply-proposal/route.ts`. Move the proposal from `lib/fundingPlan/prompt.ts` into `tools/aubreylaw-docgeneration/docs/trust-funding-plan-placeholder-map.md`, then remove the unused runtime file if no new active consumer exists.

**Interfaces:** No active public/runtime contract changes. Preserve package implementations, stored design JSON, historical provider/plan values, and document provenance columns.

- [ ] Repeat import, exported-symbol, dynamic-require, script, and documentation searches on current main. If any candidate acquired a consumer, remove it from this cleanup and record the reason; do not rewrite active callers just to meet a deletion count.
- [ ] Remove the seven confirmed orphans and unused direct `@radix-ui/react-toggle` dependency/optimize-package entry. Retain `@napi-rs/canvas`: custom runtime requires in engagement/citations are real consumers. Use the package manager to update the lockfile and inspect for unrelated version churn.
- [ ] Remove unused `isShowAsBusy`, `slotContact`, `setAttr`, the apply-proposal `DesignSheet` import, and obsolete lint suppression. Inbox-only leftovers should disappear with C2. Do not change active fiduciary/trustee decisions.
- [ ] Document Stripe as the implemented online processor and LawPay as unsupported. Retain the provider-neutral interface and historical values. Label the funding-plan prompt as an unimplemented proposal rather than runtime functionality.
- [ ] Run lint and lower the CI warning ceiling to the resulting measured count. Run typecheck, full tests, real production build, `npm run corpus:check`, and `npm run -w apps/workbench verify`; inspect any drafting output changes instead of accepting new snapshots. No new tests of mere file absence are needed. Commit as `chore: remove verified unused code and stale adapter guidance`.

## C5: Provider cutover and secondary product decisions

**Modify:** `docs/operations/communications-retirement.md`, `docs/operations/firm-workspace-boundaries.md`; transport/provider source and configuration only after the inventory's remaining consumers are resolved. Shared paths include `lib/appointments/reminders.ts`, `lib/retell/notify.ts`, `lib/twilio/sms.ts`, `lib/telnyx/sms.ts`, `lib/sms/*`, and provider webhooks under `app/api/webhooks/`. **Tests:** extend `tests/communication-capabilities.test.ts` and integration fixtures for any retained callbacks.

**Interfaces:** External delivery remains outside Cornerstone; Cornerstone retains contact links, matter context, history, and secure portal communication. No new vendor is selected implicitly.

- [ ] Produce a concrete cutover checklist from C1: each active number, inbound destination, SMS appointment reminder, Retell alert, callback, queued delivery, and credential has a disposition. For each dependency, choose a verified external replacement or obtain the owner's explicit decision to retire it. Retain the narrow adapter when that decision is pending; other releases can finish.
- [ ] Prepare and test external destination configuration using approved synthetic recipients/payloads. Live test messages, number transfers, cancellations, or routing changes require explicit action authorization; plan preparation does not perform them.
- [ ] After cutover, verify no pending sends/callback reconciliation is stranded. Remove obsolete manual endpoints and server SDKs only when the consumer inventory is empty; retain necessary callback/history readers. Remove secrets from deployment configuration only after the deployed code no longer needs them. Preserve historical DB rows and migration files.
- [ ] Verify post-cutover portal/email/calendar/document workflows and ordinary contact links; rollback code without reenabling sending or reversing routing automatically. Commit remaining transport cleanup as a separate release.
- [ ] Inventory active custom booking URLs, Calendly links, and Outlook calendar synchronization in the workspace-boundaries document. Recommend one authority using actual usage and continuity requirements; defer deletion/redirect of active booking paths until the owner selects it. Preserve appointment history and webhook reconciliation.
- [ ] Record workbench and Word integration consumers and authoritative editing ownership. Keep both working; any retirement is a separate design after usage evidence. Keep campaign-table cleanup and payment-system replacement outside this program.

The scheduling/workbench decisions are deliverable assessments with explicit boundaries, not blockers for the confirmed fixes. Communication retirement is complete only when its remaining provider dependencies are resolved or explicitly retained as narrow integrations.
