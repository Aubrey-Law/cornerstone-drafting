# Cornerstone Scope Reduction Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink Cornerstone toward a legal-workflow system of record and drafting platform. Cornerstone owns legal meaning, legal state, approvals, context, and provenance. Providers own commodity execution.

**Architecture:** No rewrite. Every reduction is taken at an existing seam — document preview, campaign dispatch, booking sync, payment adapter, job claim/finish, feature flag — so each phase ships independently and is revertible on its own. Confidentiality and reliability defects are fixed before any strategic migration, because a migration that carries a disclosure defect forward is worse than no migration.

**Tech Stack:** Next.js App Router, TypeScript, React, Supabase/Postgres with RLS and `SECURITY DEFINER` RPCs, Cloudflare R2, Vercel Cron, Vitest, Testing Library. External: Resend, Calendly, Microsoft Graph, Telnyx, Stripe, Anthropic.

**Source:** Two reconciled architecture assessments (2026-08-27). See *Provenance of inputs* below — the source documents are not in this repository.

---

## Provenance of inputs

Two paths cited in the source recommendation do **not** exist in this checkout:

| Cited path | Status |
|---|---|
| `docs/architecture-assessment-2026-08-27.md` | Not committed. Referenced from a local working copy. |
| `docs/superpowers/plans/2026-08-27-remove-crm-campaigns.md` | Not committed. Referenced from a local working copy. |

**Task 0.0** — [ ] Commit both source documents to `docs/` before Phase 2 begins, or accept that this plan is the sole written record of the campaign-removal scope. The campaign removal in Phase 2 assumes the earlier plan's inventory; if that document stays local, Phase 2's inventory step is not optional.

## Measurement corrections

Re-measured in this worktree at `55eed26`. Where the source recommendation and the measured repository disagree, the measured value governs.

| Claim in source | Measured here | Note |
|---|---:|---|
| `lib/crm` ~1,542 LOC | 485 LOC across 5 files | The larger figure only makes sense including campaign UI + API routes. |
| Campaign system total | **2,080 LOC / 15 files** | `lib/crm/campaign*`, `app/admin/settings/campaigns`, `app/api/admin/crm/campaigns/**`, unsubscribe route, Mailgun adapter, campaign cron. This is the Phase 2 blast radius. |
| Billing ~6,200 LOC | 4,771 LOC | `lib/billing`, `lib/invoices`, `components/billing`. Excludes the 25 API routes and 21 RPCs, which the source counted separately. |
| Scheduling `lib/appointments` 2,723 LOC | 3,006 LOC incl. `app/book` | Public booking UI is part of the retirement scope. |
| Softphone + voice | 2,707 LOC | `components/softphone`, `lib/retell`, `lib/telnyx`, `lib/twilio`. |
| Theme machinery | 949 LOC | `lib/theme/tokens.ts` (559) + generated CSS (390), plus the Tailwind bridge. |

**Do not re-cite the source figures.** Re-measure before each phase; these numbers move.

## Global constraints

- Confidentiality and reliability fixes (Phase 1) merge before any subsystem removal begins.
- Every removal phase is preceded by a **production evidence step**. Source code cannot establish that a table is empty, a provider route is live, or a flag has never been enabled.
- Migrations that drop tables are the **last** step of their phase, never the first, and never in the same PR as the code removal.
- Do not run `supabase db reset --linked` or reset the shared firm database.
- Every `SECURITY DEFINER` function keeps its `search_path`, non-service-role rejection, `PUBLIC`/`anon`/`authenticated` revoke, and `service_role`-only grant.
- Drafting internals stay under the `AGENTS.md` drafting policy. Phase 8 touches the renderer boundary only, and only after the golden corpus exists.
- No phase widens the Anthropic egress surface.

---

## Phase 1 — Confidentiality and reliability

Highest priority. These outrank every architectural item and are all low-effort.

### 1.1 Remove the Microsoft Office Online preview path

**Confirmed defect.** `lib/documents.ts:31-33` builds `https://view.officeapps.live.com/op/{view,embed}.aspx?src=<signed R2 URL>`. `lib/documents.ts:167-177` routes every Word preview through it. A 300-second signed URL to a client will or trust is handed to Microsoft's public viewer.

Four production call sites:

| File | Line |
|---|---|
| `app/(portal)/documents/PortalDocumentList.tsx` | 111 |
| `app/admin/matters/[id]/MatterDocumentsTab.tsx` | 319 |
| `app/admin/drafting/[matterId]/ReviewStep.tsx` | 269 |
| `components/documents/DocumentPreviewDialog.tsx` | 37 |

The authenticated replacement already exists: `getDocumentPreview()` at `lib/documents.ts:180-190` → `app/api/documents/[id]/preview/route.ts`, which authenticates, checks `userCanReadDocument`, and renders DOCX to HTML in-process via Mammoth.

- [ ] **1.1.1** Route all four Word-preview call sites through `getDocumentPreview()`. The portal call site first — it is the only one reachable by a client.
- [ ] **1.1.2** Delete `toMicrosoftOfficeViewerUrl` and collapse `getDocumentViewerUrl` to return the signed URL for non-Word types only.
- [ ] **1.1.3** Update the three tests that assert on `getDocumentViewerUrl` (`tests/drafting-hub.test.ts:96`, `tests/matter-documents-tab.test.ts:26`, `tests/matter-documents-tab-render.test.tsx:18`).
- [ ] **1.1.4** Add a regression test asserting no source file references `officeapps.live.com`.
- [ ] **1.1.5** Confirm the in-app preview renders acceptably for a generated trust package. If Mammoth fidelity is inadequate for attorney review, the remedy is `tools/docx-pdf-worker` conversion — **not** restoring the Microsoft path.

**Exit:** No signed client-document URL leaves the application to a third-party viewer.

### 1.2 Add application CI

**Confirmed gap.** `.github/workflows/` holds four workflows — `db-migrate-deploy`, `db-migration-drift`, `db-rpc-check`, `db-types-drift`. None runs `vitest`, `eslint`, or `tsc`. `vercel.json:2` sets `buildCommand` to `npm run build:next` (plain `next build`), so the typecheck wrapper never runs on deploy either, and `scripts/vercel-should-build.sh` disables non-`main` deployments, so there are no PR previews.

The suite is green and the cost is known: 4,438 tests pass in ~505s from a clean install.

- [ ] **1.2.1** Add `.github/workflows/app-ci.yml` running `npm ci`, then `lint`, `typecheck`, and `test` on pull requests and on `main`.
- [ ] **1.2.2** Use `npm ci` from the lockfile, never a warm `node_modules`. Both assessments were defeated locally by a declared-but-uninstalled `@radix-ui/react-context-menu`; CI must catch exactly that.
- [ ] **1.2.3** Cache `~/.npm` and the TypeScript `.tsbuildinfo`.
- [ ] **1.2.4** Make the workflow a required status check on `main`.
- [ ] **1.2.5** Fix or explicitly baseline the 19 current lint warnings so the gate starts clean.

### 1.3 Redact PII-bearing logs

**Confirmed at three sites:**

- `lib/email/send.ts:349-355` — logs recipient address and subject.
- `lib/bookings/sync.ts:382,395` — logs attendee email in two `console.error` calls.
- `app/api/admin/matter-details/route.ts:307` — logs the raw `value` of an arbitrary matter-detail field.

- [ ] **1.3.1** Replace identifying values with stable non-reversible references (document/matter/record id, a hashed recipient, a field *name* without its value).
- [ ] **1.3.2** Sweep the remaining server `console.*` calls for interpolated variables carrying PII. The earlier grep-based sweep missed all three sites above because it matched identifiers inside call parentheses; these pass variables. **Read the call sites; do not grep for them.**
- [ ] **1.3.3** Add an ESLint rule or test forbidding known PII-bearing identifiers as direct `console.*` arguments in `app/api/**` and `lib/**`.

### 1.4 Correct the R2 bucket configuration and fail closed

**Confirmed defect.** `VERCEL_ENV_CHECKLIST.md:13` documents `R2_BUCKET`. `lib/r2.ts:17` reads `R2_BUCKET_NAME` and falls back to the literal `'legal-documents'`. `scripts/validateEnv.mjs:16` validates `R2_BUCKET_NAME`. An operator following the checklist configures a variable nothing reads, and client documents silently go to a default bucket name.

- [ ] **1.4.1** Correct `VERCEL_ENV_CHECKLIST.md:13` to `R2_BUCKET_NAME`.
- [ ] **1.4.2** Make `lib/r2.ts` throw when `R2_BUCKET_NAME` is unset and `NODE_ENV === 'production'`. Keep the development default.
- [ ] **1.4.3** Verify the production Vercel environment actually sets `R2_BUCKET_NAME`, and that it names the bucket currently holding documents, **before** shipping the fail-closed change.
- [ ] **1.4.4** Grep the runbooks for the same drift across other env names.

### 1.5 Make the LLM draft fallback opt-in and fix its provenance label

**Confirmed defect, and the item most likely to be under-weighted.** `app/api/admin/matters/[id]/draft/route.ts:303-395` falls back automatically to per-document LLM drafting when template rendering fails, and stamps provenance `python_fallback` — a label for a Python subprocess retired long ago (`lib/estateGenerator/engine.ts:19-21`, whose own comment says the engine no longer exists).

A template regression therefore places model-authored text into a client instrument, under an audit label naming an engine that never ran.

- [ ] **1.5.1** Gate the fallback behind an explicit flag. Default: template failure returns an error to the drafter rather than substituting generated text.
- [ ] **1.5.2** Rename the provenance label to describe what actually produced the file (e.g. `llm_fallback`), and backfill existing `python_fallback` rows to the same accurate label.
- [ ] **1.5.3** Surface fallback use in the review UI so an attorney reviewing a draft can see that a document was model-authored.
- [ ] **1.5.4** Add a test asserting no new document is written with the retired label.

### 1.6 Stale-running workflow-job recovery

**Confirmed defect, conditional on Phase 6.** `claim_workflow_jobs` (`supabase/migrations/20261004000000_solo_practice_efficiency_billing.sql:479-490`) selects only `status = 'pending'`; only the surviving worker calls `finish_workflow_job`. A process death strands a job in `running` permanently. `lib/email/scheduled.ts:117-127` already implements the missing 15-minute reclaim — this is an oversight, not a design choice.

- [ ] **1.6.1** **Sequencing gate.** Do this only if Phase 6.1 retains the durable queue. If Phase 6.1 deletes it, skip — do not fix code scheduled for removal.
- [ ] **1.6.2** If retained: add a stale-`running` reclaim to `claim_workflow_jobs` mirroring the scheduled-email pattern, with attempt/backoff preserved.
- [ ] **1.6.3** Add the first direct runtime test of `processWorkflowJobs` (`lib/workflowJobs.ts` currently has none).
- [ ] **1.6.4** Batch the invoice-reminder payments read (`lib/workflowJobs.ts:158-190` issues one query per overdue invoice).

**Phase 1 exit criteria:** no third-party document disclosure; a required CI gate on `main`; no PII in server logs; R2 fails closed in production; the LLM fallback is opt-in and honestly labelled.

---

## Phase 2 — Remove campaign delivery; use Resend

The clearest agreement across both assessments. **2,080 LOC / 15 files**, six tables, one cron, one webhook.

Cornerstone owns marketing *consent*. It should not own marketing *delivery*. CAN-SPAM suppression and unsubscribe honoring are exactly what an ESP is paid to get right.

### 2.1 Production evidence — blocking

- [ ] **2.1.1** Re-run the row-count query against production immediately before removal: `crm_campaigns`, `crm_campaign_steps`, `crm_campaign_recipients`, `crm_campaign_deliveries`, `crm_campaign_dispatches`, `crm_campaign_events`. The earlier plan recorded zeroes; that evidence is stale.
- [ ] **2.1.2** If any campaign has sent, export deliveries and events to durable storage before dropping tables. Delivery history is a compliance record.
- [ ] **2.1.3** Confirm the Mailgun webhook has no traffic in the retention window.

### 2.2 Remove

- [ ] **2.2.1** Campaign builder and step engine — `app/admin/settings/campaigns/**` (page, client, detail page, detail client).
- [ ] **2.2.2** API routes — `app/api/admin/crm/campaigns/**` (list, detail, steps, queue, run).
- [ ] **2.2.3** Dispatch and audience resolution — `lib/crm/campaignDispatch.ts`, `lib/crm/campaignPolicy.ts`.
- [ ] **2.2.4** Mailgun adapter and webhook — `lib/crm/mailgunCampaigns.ts` and its webhook route.
- [ ] **2.2.5** Campaign cron — remove `/api/cron/crm-campaigns` from `vercel.json` and delete the route.
- [ ] **2.2.6** Campaign tables and RPCs — **last**, in a separate migration PR after 2.2.1–2.2.5 have been on `main` through a deploy.
- [ ] **2.2.7** Remove Mailgun env names from `VERCEL_ENV_CHECKLIST.md`, `scripts/validateEnv.mjs`, and the runbook. Revoke the Mailgun key.

### 2.3 Keep

- [ ] **2.3.1** Marketing consent and opt-out status on `cornerstone_crm_people`, with consent provenance and timestamps intact (`lib/crm/consent.ts`).
- [ ] **2.3.2** The unsubscribe token route (`/api/unsubscribe/[token]`) **until** Resend Broadcasts is live and links have migrated. See 2.4.
- [ ] **2.3.3** Transactional email logging — unaffected by this phase.
- [ ] **2.3.4** A narrow audience export (consent-filtered CSV) so Resend Segments can be populated.

### 2.4 Compliance correction — do not skip

The earlier plan's 30-day unsubscribe citation points to 16 CFR §316.5. The governing authority is **15 U.S.C. §7704**: the opt-out mechanism must remain functional for **at least 30 days after transmission**, and opt-out requests must be honored within **10 business days**.

- [ ] **2.4.1** Keep the existing unsubscribe route live for at least 30 days after the last campaign send, regardless of when the builder is deleted. Removing the route on the same day as the builder can break a live opt-out link.
- [ ] **2.4.2** Correct the citation wherever it appears in `docs/`.
- [ ] **2.4.3** Migrate consent/suppression state into Resend before retiring the local route; Resend handles unsubscribe state for Broadcasts and Automations.

**Exit:** Cornerstone records who may be marketed to and why. Resend decides delivery.

---

## Phase 3 — Consolidate scheduling on Calendly + Outlook

**3,006 LOC** including a hand-written availability solver. `lib/scheduling.ts:22-55` already hardcodes `cal.com/aubreylaw/*` as the real booking URLs — the native engine was built, then bypassed, and both were kept.

**Principle:** Calendly decides *when*. Cornerstone records *why the appointment matters*.

### 3.1 Evidence

- [ ] **3.1.1** Determine which booking surface clients actually reach today: Calendly, the Cal.com URLs in `lib/scheduling.ts`, or the native `/book/[slug]` page. Check live traffic, not source.
- [ ] **3.1.2** Confirm the Calendly ↔ Microsoft Graph free/busy path is the one in production use.

### 3.2 Retire

- [ ] **3.2.1** The native availability solver (`lib/appointments/availability.ts`).
- [ ] **3.2.2** The public `/book/[slug]` page, its booking flow, and reschedule tokens — after 3.1.1 confirms no live links point at it. Leave a redirect to the Calendly URL for any published link.
- [ ] **3.2.3** Cal.com URLs and compatibility paths in `lib/scheduling.ts`, replaced with Calendly event-type URLs from configuration rather than hardcoded strings.
- [ ] **3.2.4** Duplicate booking configuration across the two systems.

### 3.3 Retain

- [ ] **3.3.1** Matter-linked appointments and appointment status.
- [ ] **3.3.2** Reminders (`/api/cron/appointment-reminders`).
- [ ] **3.3.3** Intake and matter milestones tied to appointments.
- [ ] **3.3.4** Booking provenance and webhook reconciliation (`lib/bookings/sync.ts`) — this is the seam that makes the reduction safe, and it stays.
- [ ] **3.3.5** Microsoft Graph event creation where it writes to the attorney's calendar; drop only the free/busy solving that Calendly now owns.

---

## Phase 4 — Billing: decide the system of record, do not delete on reflex

**4,771 LOC + 25 API routes + 21 RPCs.** The evaluation is right that this is disproportionately large and liability-heavy, and wrong to imply automatic deletion. Cornerstone's billing contains legal-workflow concepts that generic invoicing does not model: engagement fee schedules, matter claims, milestones, close-out gates, and matter status coupling.

The implementation quality is also better than the surrounding narrative suggests — integer cents, a row-locking payment RPC, overpayment rejection.

### 4.1 Freeze

- [ ] **4.1.1** No new billing features, tables, or RPCs until 4.3 resolves. Bug fixes and the Phase 1 reliability items only.

### 4.2 Draw the boundary

- [ ] **4.2.1** Document the split explicitly:
  - **Cornerstone owns:** agreed fees, engagement milestones, matter claims, readiness-to-invoice, payment-status mirror, workflow gates.
  - **External owns:** invoice numbering, issued invoices, credit notes, payment ledger, refunds, reconciliation, accounting.
- [ ] **4.2.2** Identify which of the 21 RPCs cross that line. `issue_invoice`, `issue_invoice_credit_note`, and `void_invoice` are audit surface that belongs to a vendor ledger. `create_matter_fee_schedule` is legal workflow and stays.

### 4.3 Adoption evidence — blocking decision gate

- [ ] **4.3.1** Query production: issued invoice count, payment count, credit notes, and date of most recent issuance.
- [ ] **4.3.2** **If billing has not been meaningfully adopted:** retire the custom invoice engine before adoption makes migration expensive. Keep fee schedules, claims, milestones, and gates.
- [ ] **4.3.3** **If billing is operationally important:** migrate deliberately. Stripe Invoicing + accounting software, or a legal billing platform with trust-accounting rules Cornerstone does not implement. Mirror provider IDs and authoritative statuses back into Cornerstone; never re-derive them.
- [ ] **4.3.4** This is a business decision, not a refactor. It needs the owner's answer on whether invoicing actually moves to an external ledger before any line is touched.

### 4.4 Remove now, regardless of 4.3

- [ ] **4.4.1** Delete the LawPay stub (`lib/payments/lawpay.ts` and its branch in `lib/payments/index.ts`, `lib/payments/types.ts`). It advertises provider flexibility while providing no working integration. Check `supabase/migrations/20261001000000_invoice_payments_processor.sql` for a processor enum value to retire alongside it.

### 4.5 Reliability, independent of the system-of-record decision

- [ ] **4.5.1** Paginate `lib/queries/invoices.ts:196-219` ("Every invoice, newest first") and `lib/queries/matters.ts:18-34`.
- [ ] **4.5.2** Aggregate the billing dashboard's eight broad reads server-side (`lib/queries/billing.ts:279-318`).
- [ ] **4.5.3** Surface rather than silently apply truncation in `lib/queries/contactsDirectory.ts:102-120` (1,000 intakes / 2,000 contacts) and the firm directory (5,000). Reuse the cursor pattern from `lib/queries/inbox.ts:8-31`.

---

## Phase 5 — Telephony: standardize on Telnyx, remove duplication

**2,707 LOC** across `components/softphone`, `lib/retell`, `lib/telnyx`, `lib/twilio`. Telnyx is already the purchased platform. The custom part is the embedded WebRTC experience and Cornerstone-specific call context — and *that* part may be genuinely worth keeping.

### 5.1 Evidence — blocking, and time-sensitive

- [ ] **5.1.1** Verify the Telnyx production route is live and ringing **now**. The historical record says it was repaired and confirmed, but that state expires; do not remove alternatives on the strength of a past note.
- [ ] **5.1.2** Check production configuration and webhook history for Twilio and Retell before deleting either.

### 5.2 Decision

- [ ] **5.2.1** Ask the owner one question: are calls normally answered inside Cornerstone, or elsewhere?
- [ ] **5.2.2** **Answered in Cornerstone:** keep the softphone. Standardize on Telnyx, remove the Twilio and Retell overlap after 5.1.2, retain call association, notes, outcomes, and click-to-call. Do not expand toward a homegrown PBX.
- [ ] **5.2.3** **Answered elsewhere:** remove `components/softphone` entirely, keep contextual call logging and click-to-call only.
- [ ] **5.2.4** Either way, remove the unused provider half and its env names, and revoke the unused provider's keys.

---

## Phase 6 — Force a decision on every default-off subsystem

"Default false" does not prove a feature is useless. Indefinite dual paths are the actual waste — two implementations of the same operations, one of which has never run.

All three flags default `false` at `supabase/migrations/20261004000000_solo_practice_efficiency_billing.sql:5-7`.

### 6.1 `durable_workflow_jobs_enabled`

Every call site carries both an enqueue path and an inline path (`app/api/admin/matters/create/route.ts`, `lib/matters/createFromIntake.ts`).

- [ ] **6.1.1** Check production: has the flag ever been true? Are there rows in `workflow_jobs`?
- [ ] **6.1.2** **Default recommendation — delete the queue.** At solo-practice scale with the current job set, the inline path is sufficient. Remove `lib/workflowJobs.ts`, the three RPCs, the `*/5` cron, and the enqueue branch at each call site.
- [ ] **6.1.3** **Only if a concrete near-term requirement exists:** complete Phase 1.6, enable the flag, and delete the inline fallback. Do not keep both.
- [ ] **6.1.4** Whichever path: exactly one implementation survives.

### 6.2 `probate_track_enabled`

A full practice area — matter codes, SLA branches, billing schedules — behind a false flag.

- [ ] **6.2.1** Is probate planned within ~90 days?
- [ ] **6.2.2** No → remove the hidden domain surface. Yes → assign an owner and an activation date, recorded in the flag registry (6.5).

### 6.3 `billing_milestones_enabled`

- [ ] **6.3.1** Resolve as part of Phase 4. If Cornerstone keeps engagement milestones (it should, per 4.2.1), enable the flag and remove the disabled branch. If not, delete it.

### 6.4 Unused provider halves

- [ ] **6.4.1** Twilio/Telnyx → Phase 5. Calendly/Cal.com → Phase 3. LawPay/Stripe → 4.4.1. Each removed only after production configuration and webhook history are verified.

### 6.5 Flag discipline

- [ ] **6.5.1** Every remaining flag gets an owner, an activation-or-removal date, and a measurable reason to exist, recorded in `docs/`. A flag with no date is a decision that has been declined, not deferred.

---

## Phase 7 — Simplify internal machinery

Worthwhile, secondary, and safe to parallelize with the phases above once Phase 1 has merged.

- [ ] **7.1** Replace the typecheck mtime shortcut with `tsc --incremental` and CI caching. `package.json:10` prints "TypeScript OK" if `tsconfig.typecheck.tsbuildinfo` was touched within the hour. mtime is not a correctness signal.
- [ ] **7.2** Migrate the `types/supabase.ts` `any` compatibility shim to the generated `Database` type. 10,634 generated lines are currently shadowed.
- [ ] **7.3** Make CSS/Tailwind theme variables canonical. Tailwind v4 has native `@theme`; the 559-line token module, codegen script, 390-line generated CSS, 153-line bridge, and `prebuild:next` step can collapse to CSS. Retain only the minimal typed artifact the contrast tests need.
- [ ] **7.4** Delete `lib/documentSource.ts` and `lib/matterPlanType.ts` — verified zero importers.
- [ ] **7.5** Delete the confirmed unused symbols from the lint run: `formatDate` (`app/admin/inbox/InboxClient.tsx:6`), `isShowAsBusy` (`lib/appointments/graphBusy.ts:45`), `primaryId` (`lib/designSheet/initialTrusteeNomination.ts:113`), `setAttr` (`lib/docxTrackedChanges.ts:132`), `slotContact` (`lib/draftPayload/fiduciaryDetails.ts:240`), and the two type-only CRM constants (`lib/queries/cornerstoneCrm.ts:14-15`).
- [ ] **7.6** Reduce `/api/cron/scheduled-emails` from `* * * * *` to `*/5 * * * *` — ~43,000 invocations a month for a solo firm's outbound email, and five minutes is indistinguishable to any recipient. Confirm no scheduled-email feature depends on minute-level precision first.
- [ ] **7.7** Preserve URL aliases (`app/admin/crm/opportunities`, `crm/people`) as redirects until references are migrated. Do not delete the re-export files outright.
- [ ] **7.8** Remove the live Lawmatics OAuth surface only if no longer used — four routes (`connect`, `callback`, `pull`, `status`), an import dialog, and `lib/lawmatics*`, ~1,470 LOC including migrations. An offline one-time import utility may be sufficient; a live OAuth surface for a completed migration is standing attack surface.
- [ ] **7.9** Investigate `cornerstone_crm_settings` and `user_mcp_oauth_tokens` — zero application references each, but check production rows and external consumers before dropping. **Do not** treat zero `.from()` calls as deletion evidence: `contact_merges` and `generated_document_clause_revisions` have none and are written by RPCs and triggers.
- [ ] **7.10** Move `docs/superpowers/plans` and `specs` documents that are complete into a dated `archive/` folder — valuable as history, misleading as current guidance.
- [ ] **7.11** Consolidate the `lib/matter` / `lib/matters` split.

---

## Phase 8 — Drafting: build the oracle before touching the renderer

The drafting layer is the product. Its workflow, payload assembly, manifests, provenance, package selection, review, and persistence are the strongest contracts in the repository and are **not** in scope for reduction.

The concentrated liability is narrow: three renderer families (`lib/documentTemplates/types.ts:1-2`) and a 444-line OOXML/Nunjucks repair engine (`lib/estateGenerator/node/templateRenderer.ts:24-75,390-444`) whose single transformation can silently alter every generated Word package.

- [ ] **8.1** Build an attorney-approved golden-document corpus: approved input fact patterns paired with attorney-reviewed expected output. Marker completeness and XML validity are not legal fidelity.
- [ ] **8.2** Run both renderer implementations against the corpus with semantic and visual comparison.
- [ ] **8.3** Only then consolidate or replace. The keep/replace decision is made on corpus evidence, not on line count.
- [ ] **8.4** Phase 1.5 (opt-in fallback, honest provenance) is a prerequisite and ships long before this.

### 8.5 Repository structure — do not split on reflex

- [ ] **8.5.1** Keep `tools/docx-pdf-worker` in this repository. A separately deployed service still benefits from monorepo contract tests and coordinated releases. Revisit only if its deploy lifecycle actually causes incidents.
- [ ] **8.5.2** Keep drafting templates versioned atomically with their schemas and expected output. The right model is immutable template versions, SHA/provenance manifests, attorney-approved golden documents, and possibly Git LFS or authenticated template storage — **not** a separate repository that lets a template drift from the schema that fills it.
- [ ] **8.5.3** Make Cornerstone the canonical owner of `packages/estate-fields`. The mirrored `file:` dependency (`package.json:41`) is the weak point: versioning pain with none of the benefit. If another application needs the registry, publish a versioned private package outward.
- [ ] **8.5.4** Separately: make the registry actually canonical, or remove it. Only three application/test files import it today. A registry that does not drive schema, UI, persistence, validation, and payload generation is one more representation, not a solution.

---

## Deferred — necessary, but not scope reduction

These are refactors the assessments identified. They do not belong in a shrink plan, and they should not be lost.

| Item | Evidence | Why deferred |
|---|---|---|
| `matter_contacts` migration step 7b | `docs/matter-contacts-migration.md:961-983` — written, unapplied. Two authoritative writers per join row until it lands. | Blocking gate is a production consistency check (`npm run check:matter-contacts`), not a code change. |
| Design-sheet field canonicalization | `trust_protector` spans 26 files and changes type at the DB boundary (`types/supabase.generated.ts:2577` text vs `types/database.ts:337` boolean). `lib/designSheet/dualWriteProvisions.ts:4-20` records this reaching a signed will. | The single best evidence that duplicated representation causes legal defects. Belongs in a dedicated plan. |
| `resolveMatterId` | `lib/draftPayload/resolveMatterId.ts:3-84` — seven sequential lookups, returns its input unchanged on failure, making failure indistinguishable from success. | Must coordinate with step 7b. |
| `matter_id text` across 10 tables | No FK to `matters.id uuid`; RLS joins via `m.id::text`. | Needs a legacy-ID inventory first, not a blind type conversion. |
| Staff/VA authorization | RLS admits `va`/`staff` across many policy clauses (137 literal occurrences in migrations); `ADMIN_ROLES` is duplicated across 6 files and admits neither. 183 API routes use the service-role client, bypassing RLS. | The gate on hiring, not on database capacity. Collapse `ADMIN_ROLES` to one constant now (cheap); matter-scoped permissions before any staff account exists. |
| `li_design_sheet_data` third representation | `saveLiDesignSheet` at `app/admin/drafting/[matterId]/design/actions.ts:23-29` — bare `update ... eq('id')`, last-write-wins, while the main sheet uses DB compare-and-swap returning 409. | Give it the same CAS. Small, and unrelated to scope reduction. |
| Live-Postgres tests | Zero tests instantiate a Supabase client. 177 test files assert on source text via `readFileSync` + `toContain` — they pass while behavior breaks, and they raise refactor cost. | Every removal phase above is safer with them, and none is blocked on them. |

---

## Sequence and dependencies

```
Phase 1  Confidentiality + reliability        ← blocks everything
   │
   ├─ Phase 2  Campaigns → Resend             (independent)
   ├─ Phase 3  Scheduling → Calendly          (independent)
   ├─ Phase 5  Telephony → Telnyx             (needs live verification)
   └─ Phase 7  Internal machinery             (independent, parallel)
   │
Phase 4  Billing system-of-record decision    ← owner decision required
   │
Phase 6  Default-off resolution               ← consumes 3, 4, 5 outcomes
   │
Phase 8  Drafting golden corpus → renderer    ← last, and only with the oracle
```

Phase 1.6 is gated on Phase 6.1: do not fix a queue scheduled for deletion.
Phase 6.3 is gated on Phase 4.3.
Phase 6.4 is gated on Phases 3, 4.4, and 5.

## Estimated reduction

Assuming campaign removal, scheduling consolidation, the durable-queue deletion, provider-duplication removal, and the theme/dead-code cleanup — and holding billing at the boundary rather than deleting it:

**Roughly 6,000–9,000 lines, ~10 tables, and one cron**, with no loss of anything that differentiates the product. Billing's disposition swings this by several thousand more, in either direction, and is the owner's call.

## What this plan explicitly refuses

- **No rewrite.** Neither assessment found a case for one, and the seams exist.
- **No deletion of drafting.** It is the product; only the renderer boundary is in question, and only with an oracle.
- **No deletion of billing on reflex.** Reduce to a boundary; then decide the system of record on adoption evidence.
- **No categorical removal of telephony.** Verify the live route, then remove duplication.
- **No repository splits justified only by "it's a service" or "it has binaries."**
- **No table drop without production evidence.** Zero `.from()` calls is not deletion evidence for trigger-, RPC-, audit-, or externally-owned tables.
