# E-Signature Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Cornerstone's engagement-agreement signing lifecycle, make the integration provider-neutral, and evaluate a self-hosted Documenso deployment without changing the production provider automatically.

**Architecture:** Firma remains the production provider while shared contracts normalize request state, recipient state, lifecycle actions, webhook hints, and evidence artifacts. Additive database changes preserve every active Firma request. After the shared path is proven, a separate Documenso staging service implements the same contract and is compared through a synthetic-document acceptance run.

**Tech Stack:** Next.js App Router, TypeScript, React, Supabase/Postgres with RLS and `SECURITY DEFINER` RPCs, Cloudflare R2, Firma REST API and SDK, Documenso V2 REST API, Vercel Cron, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-22-esignature-enhancement-design.md`

## Global Constraints

- Firma remains the production default throughout this plan.
- Documenso receives no client data and cannot be selected in production without `DOCUMENSO_PRODUCTION_ENABLED=true`.
- This plan covers ordinary engagement agreements only, not final estate-plan execution packets.
- Preserve exact-revision approval, SHA-256 binding, recipient ordering, lead conversion, R2 retention, matter-document creation, and signed-date synchronization.
- Webhook payloads are hints; durable business changes require an authoritative provider fetch.
- Do not modify design sheets, estate draft payloads, estate document generation, or drafting interview skills.
- Migrations are additive. Do not drop `firma_request_id`, `firma_recipient_id`, `firma_webhook_events`, or the legacy Firma request path during this plan.
- Every `SECURITY DEFINER` function must set `search_path`, reject non-service-role callers, revoke `PUBLIC`, `anon`, and `authenticated`, and grant only `service_role`.
- Do not run `supabase db reset --linked` or reset the shared firm database.
- Live sends require separate explicit authorization and authorized test recipients.

---

## File Structure

- `lib/esign/types.ts` — provider-neutral request, state, capability, action, and artifact contracts.
- `lib/esign/registry.ts` — environment-aware provider resolution and production guard.
- `lib/esign/firma.ts` — Firma implementation only; no persistence or business transitions.
- `lib/esign/documenso.ts` — staging Documenso implementation.
- `lib/esign/webhooks/types.ts` — normalized webhook hint and adapter interfaces.
- `lib/esign/webhooks/firma.ts` — Firma raw-body verification and payload parsing.
- `lib/esign/webhooks/documenso.ts` — Documenso shared-secret verification and payload parsing.
- `lib/engagement/esignProcessor.ts` — authoritative state application, recipient updates, evidence storage, and completion effects.
- `lib/engagement/esignArtifacts.ts` — deterministic R2 storage and artifact persistence.
- `lib/engagement/reconcile.ts` — bounded stale-agreement reconciliation.
- `components/engagement/EngagementStatusPanel.tsx` — post-send status and actions.
- `app/api/admin/engagement-agreements/[id]/status/route.ts` — manual authoritative refresh.
- `app/api/admin/engagement-agreements/[id]/resend/route.ts` — recipient-scoped resend.
- `app/api/admin/engagement-agreements/[id]/cancel/route.ts` — confirmed cancellation.
- `app/api/admin/engagement-agreements/[id]/artifacts/[kind]/route.ts` — authorized durable evidence download.
- `app/api/cron/esign-reconciliation/route.ts` — protected background reconciliation.
- `supabase/migrations/20261008000000_esign_provider_neutrality.sql` — additive generic columns, artifacts, event claims, and indexes.
- `docs/integrations/documenso-pilot.md` — deployment, backup, restore, and acceptance runbook.

---

### Task 1: Lock the Provider-Neutral Contract and Firma Behavior

**Files:**
- Modify: `lib/esign/types.ts`
- Modify: `lib/esign/firma.ts`
- Create: `lib/esign/registry.ts`
- Create: `tests/esign-provider-contract.test.ts`
- Modify: `tests/firma-document-request.test.ts`

**Interfaces:**
- Produces: `EsignProviderName`, `EsignArtifact`, `EsignDocumentRequestState`, `EsignProviderCapabilities`, `EsignProvider`, and `resolveEsignProvider()`.
- Consumes: existing Firma request endpoints and `FIRMA_API_KEY`.

- [ ] **Step 1: Write failing shared-contract tests**

Add tests that require normalized statuses, recipient IDs, capability flags, separate artifacts, resend scoping, cancellation, and a production guard:

```ts
expect(provider.capabilities).toEqual({
  resend: true,
  cancel: true,
  embeddedSigning: true,
  separateAuditCertificate: false,
})
await provider.resendDocumentRequest({
  requestId: 'request-1',
  recipientIds: ['recipient-1'],
  customMessage: 'Please complete your signature.',
})
expect(fetcher).toHaveBeenCalledWith(
  expect.stringContaining('/signing-requests/request-1/resend'),
  expect.objectContaining({ method: 'POST' }),
)
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
npx vitest run tests/esign-provider-contract.test.ts tests/firma-document-request.test.ts
```

Expected: FAIL because the capabilities, artifacts, resend method, cancel method, and registry do not exist.

- [ ] **Step 3: Replace the contract with exact normalized types**

Implement:

```ts
export type EsignProviderName = 'firma' | 'documenso'
export type EsignArtifactKind = 'signed_pdf' | 'audit_certificate' | 'combined_evidence'
export type EsignArtifact = {
  kind: EsignArtifactKind
  url: string
  mimeType: 'application/pdf' | 'application/zip'
}
export type EsignRecipientState = EsignExternalRecipient & {
  email: string
  status: 'sent' | 'viewed' | 'signed' | 'declined'
  viewedAt: string | null
  signedAt: string | null
  declinedAt: string | null
}
export type EsignDocumentRequestState = {
  status: EsignDocumentRequestStatus
  completedAt: string | null
  recipients: EsignRecipientState[]
  artifacts: EsignArtifact[]
}
export type EsignProviderCapabilities = {
  resend: boolean
  cancel: boolean
  embeddedSigning: boolean
  separateAuditCertificate: boolean
}
```

Update `EsignProvider` to expose `capabilities`, `resendDocumentRequest`, and `cancelDocumentRequest`. Keep `createEngagementEnvelope` temporarily outside the new request path and mark it deprecated in its comment.

- [ ] **Step 4: Implement Firma resend, cancel, and normalized state**

Use Firma's documented endpoints:

```ts
await this.fetcher(`${base}/signing-requests/${encodeURIComponent(requestId)}/resend`, {
  method: 'POST',
  headers: this.headers(),
  body: JSON.stringify({ recipient_ids: recipientIds, custom_message: customMessage }),
})
```

Normalize completion evidence as `combined_evidence` when Firma returns its combined final document. Keep recipient correlation based on the persisted temporary key and real external recipient ID.

- [ ] **Step 5: Implement provider resolution with a production guard**

```ts
export function resolveEsignProvider(): { ok: true; provider: EsignProvider } | { ok: false; error: string } {
  const name = (process.env.ESIGN_PROVIDER?.trim() || 'firma') as EsignProviderName
  if (name === 'documenso' && process.env.VERCEL_ENV === 'production' && process.env.DOCUMENSO_PRODUCTION_ENABLED !== 'true') {
    return { ok: false, error: 'Documenso is not approved for production.' }
  }
  if (name === 'documenso') return { ok: false, error: 'Documenso pilot is not installed.' }
  return resolveFirma()
}
```

Keep Firma environment validation inside `resolveFirma()`. Task 8 replaces the staging-only error with `resolveDocumenso()` after the adapter exists, while retaining the production guard.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npx vitest run tests/esign-provider-contract.test.ts tests/firma-document-request.test.ts tests/esign.test.ts
```

Expected: PASS.

Commit:

```bash
git add lib/esign/types.ts lib/esign/firma.ts lib/esign/registry.ts tests/esign-provider-contract.test.ts tests/firma-document-request.test.ts
git commit -m "refactor: normalize e-sign provider contract"
```

---

### Task 2: Add Provider-Neutral Persistence Without Breaking Firma

**Files:**
- Create: `supabase/migrations/20261008000000_esign_provider_neutrality.sql`
- Modify: `lib/engagement/repository.ts`
- Modify: `lib/engagement/runtime.ts`
- Create: `tests/esign-provider-migration.test.ts`
- Modify: `tests/engagement-repository.test.ts`

**Interfaces:**
- Produces: generic provider/request/recipient columns, `engagement_esign_artifacts`, `esign_webhook_events`, and `claim_esign_webhook_event(...)`.
- Consumes: normalized provider names from Task 1.

- [ ] **Step 1: Write failing migration contract tests**

Require additive backfills, compound uniqueness, RLS, processing leases, and service-role-only RPC execution:

```ts
expect(sql).toContain("add column if not exists provider text not null default 'firma'")
expect(sql).toContain('external_request_id text')
expect(sql).toContain('engagement_agreements_provider_request_uidx')
expect(sql).toContain('create table public.engagement_esign_artifacts')
expect(sql).toContain('create table public.esign_webhook_events')
expect(sql).toContain('grant execute on function public.claim_esign_webhook_event')
expect(sql).toContain('to service_role')
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run tests/esign-provider-migration.test.ts tests/engagement-repository.test.ts
```

Expected: FAIL because the migration and generic repository functions do not exist.

- [ ] **Step 3: Write the additive migration**

Use this schema shape:

```sql
alter table public.engagement_agreements
  add column if not exists provider text not null default 'firma',
  add column if not exists external_request_id text,
  add column if not exists last_provider_sync_at timestamptz,
  add column if not exists provider_sync_error text,
  add column if not exists provider_sync_error_at timestamptz;

update public.engagement_agreements
set external_request_id = firma_request_id
where external_request_id is null and firma_request_id is not null;

create unique index if not exists engagement_agreements_provider_request_uidx
  on public.engagement_agreements(provider, external_request_id)
  where external_request_id is not null;

alter table public.engagement_agreement_recipients
  add column if not exists external_recipient_id text,
  add column if not exists last_reminded_at timestamptz;

update public.engagement_agreement_recipients
set external_recipient_id = firma_recipient_id
where external_recipient_id is null and firma_recipient_id is not null;
```

Create `engagement_esign_artifacts` with `agreement_id`, `kind`, `provider`, `r2_key`, `sha256`, `byte_size`, `mime_type`, and `retrieved_at`, unique on `(agreement_id, kind, sha256)`. Create `esign_webhook_events` by copying the Firma event lifecycle fields and adding `provider`; unique `(provider, event_id)`.

- [ ] **Step 4: Add a leased provider-neutral event claim**

`claim_esign_webhook_event` must return exactly `claimed`, `duplicate`, or `in_progress`. It may reclaim a failed or lease-expired event, and it must reject non-service-role callers. Revoke default execution and grant only `service_role`.

- [ ] **Step 5: Dual-write generic and Firma compatibility columns**

Replace `recordFirmaRequest` and `recordFirmaRecipients` with:

```ts
export async function recordExternalRequest(
  client: SupabaseClient,
  agreementId: string,
  provider: EsignProviderName,
  requestId: string,
) {
  return one(client.from('engagement_agreements').update({
    provider,
    external_request_id: requestId,
    ...(provider === 'firma' ? { firma_request_id: requestId } : {}),
  }).eq('id', agreementId).eq('status', 'sending').select().single())
}
```

Apply the same compatibility rule to recipient IDs. Update runtime reads to prefer the generic column and fall back to Firma columns.

- [ ] **Step 6: Verify migration safety and commit**

Run:

```bash
npx vitest run tests/esign-provider-migration.test.ts tests/engagement-repository.test.ts tests/engagement-service.test.ts
npx supabase db push --dry-run
```

Expected: tests PASS; dry run lists only the new migration and performs no write.

Commit:

```bash
git add supabase/migrations/20261008000000_esign_provider_neutrality.sql lib/engagement/repository.ts lib/engagement/runtime.ts tests/esign-provider-migration.test.ts tests/engagement-repository.test.ts
git commit -m "feat: add provider-neutral e-sign persistence"
```

---

### Task 3: Split Webhook Verification From Authoritative Processing

**Files:**
- Create: `lib/esign/webhooks/types.ts`
- Create: `lib/esign/webhooks/firma.ts`
- Create: `lib/engagement/esignProcessor.ts`
- Modify: `app/api/webhooks/esign/route.ts`
- Create: `tests/esign-webhook-adapters.test.ts`
- Modify: `tests/firma-webhook-route.test.ts`

**Interfaces:**
- Produces: `EsignWebhookAdapter`, `EsignWebhookHint`, and `processEsignHint(...)`.
- Consumes: `claim_esign_webhook_event` and `resolveEsignProvider()`.

- [ ] **Step 1: Write failing adapter and processor tests**

Test raw-body verification before JSON parsing, Firma secret rotation, normalized event/request IDs, event leases, authoritative provider fetch, duplicate no-op, retryable in-progress response, and unknown-request acknowledgement.

```ts
expect(adapter.parse(rawBody, headers)).toEqual({
  provider: 'firma',
  eventId: 'event-1',
  eventType: 'signing_request.completed',
  externalRequestId: 'request-1',
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run tests/esign-webhook-adapters.test.ts tests/firma-webhook-route.test.ts
```

Expected: FAIL because adapters and the shared processor do not exist.

- [ ] **Step 3: Implement the narrow webhook interfaces**

```ts
export type EsignWebhookHint = {
  provider: EsignProviderName
  eventId: string
  eventType: string
  externalRequestId: string
}

export interface EsignWebhookAdapter {
  readonly provider: EsignProviderName
  verify(rawBody: string, headers: Headers): boolean
  parse(rawBody: string, headers: Headers): EsignWebhookHint
}
```

Move Firma verification and payload parsing into `lib/esign/webhooks/firma.ts`. Do not move database or matter behavior into the adapter.

- [ ] **Step 4: Extract the shared processor**

`processEsignHint` must perform this exact sequence:

1. Look up the agreement by `(provider, external_request_id)`.
2. Claim `(provider, event_id, external_request_id)` atomically.
3. Return 503 for `in_progress` so the provider retries.
4. Return success for `duplicate` only after an earlier delivery completed.
5. Fetch authoritative provider state.
6. Apply normalized recipient and agreement state.
7. Store evidence through Task 4's interface once available.
8. Mark the event processed or failed.

Keep the legacy `matter_details` and `client_intake` Firma reconciliation branch until active legacy envelopes have been audited.

For this task's independently green deliverable, call the existing signed-document storage helper through a temporary processor dependency. Task 4 replaces that dependency with `storeEsignArtifacts`; do not remove completed-document retention between the two tasks.

- [ ] **Step 5: Reduce the route to adapter selection and response mapping**

The route reads the raw body once, selects the adapter from the configured/requested provider, verifies, parses, and calls the processor. Continue accepting the existing Firma URL during compatibility. Add `/api/webhooks/esign?provider=firma` support; never authenticate with the query parameter.

- [ ] **Step 6: Run focused regression tests and commit**

Run:

```bash
npx vitest run tests/esign-webhook-adapters.test.ts tests/firma-webhook-route.test.ts tests/esign.test.ts tests/matter-owned-lead-lifecycle.test.ts
```

Expected: PASS.

Commit:

```bash
git add lib/esign/webhooks lib/engagement/esignProcessor.ts app/api/webhooks/esign/route.ts tests/esign-webhook-adapters.test.ts tests/firma-webhook-route.test.ts
git commit -m "refactor: isolate e-sign webhook processing"
```

---

### Task 4: Store Signed PDFs and Audit Evidence With Provenance

**Files:**
- Create: `lib/engagement/esignArtifacts.ts`
- Modify: `lib/engagement/esignProcessor.ts`
- Modify: `lib/engagement/repository.ts`
- Create: `app/api/admin/engagement-agreements/[id]/artifacts/[kind]/route.ts`
- Create: `tests/esign-artifacts.test.ts`
- Modify: `tests/firma-webhook-route.test.ts`

**Interfaces:**
- Produces: `storeEsignArtifacts(...)` and authorized artifact downloads.
- Consumes: normalized `EsignArtifact[]` from Task 1 and artifact persistence from Task 2.

- [ ] **Step 1: Write failing evidence tests**

Cover deterministic keys, SHA-256 calculation, separate artifact kinds, duplicate writes, short-lived provider URL failures, R2 success followed by database retry, and staff authorization.

```ts
expect(result).toEqual(expect.arrayContaining([
  expect.objectContaining({ kind: 'signed_pdf', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
  expect.objectContaining({ kind: 'audit_certificate' }),
]))
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run tests/esign-artifacts.test.ts tests/firma-webhook-route.test.ts
```

Expected: FAIL because artifact storage and routes do not exist.

- [ ] **Step 3: Implement deterministic artifact storage**

```ts
const r2Key = `matters/${matterId}/signed/engagement-${agreementId}/${artifact.kind}-${sha256}.pdf`
```

Fetch URLs server-side, reject non-PDF/non-ZIP content, enforce a bounded byte size, compute SHA-256 before upload, write to R2, then insert metadata with `upsert(..., { onConflict: 'agreement_id,kind,sha256' })`.

- [ ] **Step 4: Preserve matter-document behavior**

Create or update the signed agreement matter document from `signed_pdf` or `combined_evidence`. Store the audit certificate as a second labeled document when separate. Do not create duplicate matter documents for retries.

- [ ] **Step 5: Implement authorized downloads**

The route must call `requireEngagementStaff()`, verify the requested agreement through `getScopedAgreement`, look up the stored artifact by kind, and stream from Cornerstone storage. It must never redirect a user to an expired provider URL.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npx vitest run tests/esign-artifacts.test.ts tests/firma-webhook-route.test.ts tests/engagement-signed-date-sync.test.ts
```

Expected: PASS.

Commit:

```bash
git add lib/engagement/esignArtifacts.ts lib/engagement/esignProcessor.ts lib/engagement/repository.ts app/api/admin/engagement-agreements tests/esign-artifacts.test.ts tests/firma-webhook-route.test.ts
git commit -m "feat: retain e-sign evidence with provenance"
```

---

### Task 5: Add Refresh, Resend, Cancel, and Evidence Controls

**Files:**
- Create: `components/engagement/EngagementStatusPanel.tsx`
- Modify: `components/engagement/EngagementWorkspace.tsx`
- Modify: `lib/engagement/http.ts`
- Modify: `lib/engagement/service.ts`
- Create: `app/api/admin/engagement-agreements/[id]/status/route.ts`
- Create: `app/api/admin/engagement-agreements/[id]/resend/route.ts`
- Create: `app/api/admin/engagement-agreements/[id]/cancel/route.ts`
- Create: `tests/engagement-esign-actions.test.ts`
- Modify: `tests/engagement-workspace-interaction.test.ts`

**Interfaces:**
- Produces: service methods `refreshSigningState`, `resendToRecipients`, and `cancelSigningRequest`.
- Consumes: provider capabilities, normalized state, persisted external IDs, and artifact routes.

- [ ] **Step 1: Write failing service and route tests**

Require attorney/admin authorization, agreement scoping, valid source states, unsigned-recipient filtering, exact cancellation confirmation, provider re-fetch after actions, and activity metadata.

```ts
await expect(service.resendToRecipients({
  agreementId: 'a1',
  recipientKeys: ['primary'],
  customMessage: 'Please sign.',
  actorId: 'user-1',
})).resolves.toEqual({ notified: ['primary'] })
```

Test that a signed recipient, missing external ID, completed agreement, or provider without resend capability is rejected before any provider call.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run tests/engagement-esign-actions.test.ts tests/engagement-workspace-interaction.test.ts
```

Expected: FAIL because actions and the status panel do not exist.

- [ ] **Step 3: Implement service actions**

- `refreshSigningState` fetches authoritative state and calls the shared processor without creating a webhook event.
- `resendToRecipients` maps stable role keys to external recipient IDs, calls the provider, records `last_reminded_at`, then refreshes state.
- `cancelSigningRequest` requires `confirmation === agreementId`, calls the provider, then refreshes state; it never directly writes `cancelled` based only on the API call response.

- [ ] **Step 4: Implement narrow API routes**

Each route calls `requireEngagementStaff()` and `getScopedAgreement(id)`. Request bodies are:

```ts
type ResendBody = { recipientKeys: Array<'primary' | 'spouse'>; customMessage?: string }
type CancelBody = { confirmation: string; reason: string }
```

Reject empty recipient lists, messages over 1,000 characters, cancellation reasons under 5 characters, and unknown keys.

- [ ] **Step 5: Build the status panel**

Show overall and recipient badges, timestamps, last sync, actionable error, Refresh, recipient-specific Resend, confirmed Cancel, and available artifact downloads. Disable unsupported provider actions from `capabilities`. Preserve the reviewed revision and existing Send controls.

- [ ] **Step 6: Verify accessibility and mobile behavior**

Add Testing Library coverage for keyboard activation, confirmation labeling, disabled action explanations, live status messages, and a 320px layout contract with wrapped action rows and no fixed-width overflow.

- [ ] **Step 7: Run tests and commit**

Run:

```bash
npx vitest run tests/engagement-esign-actions.test.ts tests/engagement-workspace-interaction.test.ts tests/engagement-workspace.test.ts
npx eslint components/engagement/EngagementStatusPanel.tsx components/engagement/EngagementWorkspace.tsx lib/engagement/service.ts app/api/admin/engagement-agreements
```

Expected: PASS.

Commit:

```bash
git add components/engagement lib/engagement app/api/admin/engagement-agreements tests/engagement-esign-actions.test.ts tests/engagement-workspace-interaction.test.ts
git commit -m "feat: add engagement signing controls"
```

---

### Task 6: Add Bounded Reconciliation and Operational Health

**Files:**
- Create: `lib/engagement/reconcile.ts`
- Create: `app/api/cron/esign-reconciliation/route.ts`
- Modify: `vercel.json`
- Create: `tests/esign-reconciliation.test.ts`
- Modify: `VERCEL_ENV_CHECKLIST.md`
- Modify: `OPERATIONS_RUNBOOK.md`

**Interfaces:**
- Produces: `reconcileStaleAgreements({ limit, now })` and a CRON-secret-protected endpoint.
- Consumes: provider registry, shared processor, and provider sync columns.

- [ ] **Step 1: Write failing reconciliation tests**

Test selection of only `sending`, `sent`, `viewed`, and `partially_signed` rows older than fifteen minutes; a maximum batch of 25; provider grouping; success/error timestamps; and no automatic resend or cancellation.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run tests/esign-reconciliation.test.ts
```

Expected: FAIL because reconciliation does not exist.

- [ ] **Step 3: Implement bounded reconciliation**

```ts
export async function reconcileStaleAgreements({ limit = 25, now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - 15 * 60_000).toISOString()
  // Query allowed states with last_provider_sync_at null or < cutoff,
  // cap to Math.min(limit, 25), resolve each row's provider, and refresh.
}
```

Process sequentially or with a maximum concurrency of three. Store sanitized error messages; never store tokens, signing links, or provider payloads in operational error columns.

- [ ] **Step 4: Implement the protected cron route**

Use the repository's established contract:

```ts
if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
  return Response.json({ error: 'Unauthorized' }, { status: 401 })
}
```

Return counts for selected, reconciled, completed, and failed rows.

- [ ] **Step 5: Configure and document operations**

Add a 15-minute Vercel Cron entry. Document alert thresholds: any agreement stuck in `sending` over 30 minutes, three consecutive sync failures, or signed state without stored evidence over 15 minutes.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npx vitest run tests/esign-reconciliation.test.ts tests/engagement-service.test.ts tests/firma-webhook-route.test.ts
```

Expected: PASS.

Commit:

```bash
git add lib/engagement/reconcile.ts app/api/cron/esign-reconciliation/route.ts vercel.json tests/esign-reconciliation.test.ts VERCEL_ENV_CHECKLIST.md OPERATIONS_RUNBOOK.md
git commit -m "feat: reconcile stalled e-sign requests"
```

---

### Task 7: Complete Controlled Firma Acceptance

**Files:**
- Modify: `scripts/firma-engagement-poc.mjs`
- Modify: `docs/integrations/firma-engagement-poc.md`
- Create: `tests/firma-acceptance-contract.test.ts`

**Interfaces:**
- Produces: a guarded individual/couple acceptance harness and redacted verification record.
- Consumes: the production-shaped Firma adapter from Tasks 1–6.

- [ ] **Step 1: Add a failing source-contract test for safeguards**

Require non-production workspace sentinel, explicit real-recipient authorization, separate send authorization, redacted output, individual/couple mode, PDF geometry validation, recipient-order assertions, webhook event-ID assertions, and evidence retrieval assertions.

- [ ] **Step 2: Extend the guarded harness without sending**

Default behavior creates unsent requests only. Add `FIRMA_POC_MODE=individual|couple`, reject duplicate signer emails, and print only request IDs and normalized status—not signing links or client data.

- [ ] **Step 3: Run local source and unit checks**

Run:

```bash
npx vitest run tests/firma-acceptance-contract.test.ts tests/firma-engagement-poc.test.ts tests/firma-document-request.test.ts
```

Expected: PASS.

- [ ] **Step 4: Stop for explicit live-send authorization**

Before any deliverable email or webhook test, present the exact workspace, recipient addresses, number of envelopes, and expected side effects. Do not proceed without approval.

- [ ] **Step 5: Execute the authorized acceptance matrix**

After approval, complete one individual and one couple request. Verify Letter page geometry, field placement, recipient order, recipient-scoped resend, completion, webhook HMAC/event ID, duplicate webhook behavior, signed PDF, audit evidence, R2 retention, and matter-document creation.

- [ ] **Step 6: Record redacted results and commit**

Update the POC document with confirmed facts and remaining blockers. Do not include credentials, client data, signing links, or unredacted payloads.

Commit:

```bash
git add scripts/firma-engagement-poc.mjs docs/integrations/firma-engagement-poc.md tests/firma-acceptance-contract.test.ts
git commit -m "test: verify Firma engagement lifecycle"
```

---

### Task 8: Implement and Deploy the Staging-Only Documenso Pilot

**Files:**
- Create: `lib/esign/documenso.ts`
- Create: `lib/esign/webhooks/documenso.ts`
- Create: `lib/engagement/esignFields.ts`
- Modify: `lib/esign/registry.ts`
- Modify: `app/api/webhooks/esign/route.ts`
- Create: `tests/documenso-provider.test.ts`
- Create: `tests/documenso-webhook.test.ts`
- Create: `docs/integrations/documenso-pilot.md`
- Modify: `VERCEL_ENV_CHECKLIST.md`

**Interfaces:**
- Produces: a complete `EsignProvider` implementation and webhook adapter for Documenso V2.
- Consumes: exact normalized contracts from Tasks 1 and 3.

- [ ] **Step 1: Write failing provider and webhook tests**

Test multipart `POST /api/v2/envelope/create`, percentage field coordinates, recipient order, `POST /envelope/{id}/distribute`, state normalization, signed-document download, audit-log download, cancellation, resend capability reporting, constant-time shared-secret comparison, and production rejection.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run tests/documenso-provider.test.ts tests/documenso-webhook.test.ts
```

Expected: FAIL because the provider and adapter do not exist.

- [ ] **Step 3: Implement the Documenso V2 adapter**

Use `DOCUMENSO_BASE_URL` and `DOCUMENSO_API_TOKEN`. Upload only PDFs. Add `resolveEsignFields({ masterVersion, clientMode, recipients })` in `lib/engagement/esignFields.ts`; it returns each field's marker plus a validated `{ page, x, y, width, height }` percentage placement. Firma continues using the marker while Documenso uses the placement. Reject a Documenso request if any required field lacks a placement; do not ask Documenso to convert DOCX.

Normalize `DRAFT`, `PENDING`, `COMPLETED`, `REJECTED`, and cancelled states. Return `signed_pdf` from the signed envelope-item download and `audit_certificate` from the envelope audit-log endpoint.

- [ ] **Step 4: Implement the webhook adapter**

Verify `X-Documenso-Secret` with a constant-time comparison. Parse `payload.envelopeId` as the canonical request ID. Treat the webhook only as a hint and re-fetch the envelope before any durable state change.

- [ ] **Step 5: Write the deployment and recovery runbook**

Document a separate PostgreSQL database, signing certificate, SMTP/Resend, S3-compatible storage test, TLS, outbound egress restrictions, backup schedule, restore steps, upgrade procedure, and synthetic-recipient restrictions. Include the AGPL review gate and prohibit production enablement.

- [ ] **Step 6: Deploy staging and run the synthetic matrix**

Run ten individual, ten couple, one decline, one cancellation, one expiration, a duplicate webhook, a webhook outage/reconciliation recovery, and a backup restore. Record PDF geometry, field placement, email delivery, evidence, recovery time, infrastructure cost, and operator time.

- [ ] **Step 7: Run automated checks and commit**

Run:

```bash
npx vitest run tests/documenso-provider.test.ts tests/documenso-webhook.test.ts tests/esign-provider-contract.test.ts
npm run typecheck
```

Expected: focused tests PASS; typecheck has no new failures compared with the clean baseline.

Commit:

```bash
git add lib/esign/documenso.ts lib/esign/webhooks/documenso.ts lib/engagement/esignFields.ts lib/esign/registry.ts app/api/webhooks/esign/route.ts tests/documenso-provider.test.ts tests/documenso-webhook.test.ts docs/integrations/documenso-pilot.md VERCEL_ENV_CHECKLIST.md
git commit -m "feat: add guarded Documenso pilot"
```

---

### Task 9: Produce the Provider Decision Report and Release Gate

**Files:**
- Create: `docs/integrations/esign-provider-decision.md`
- Modify: `OPERATIONS_RUNBOOK.md`

**Interfaces:**
- Produces: an owner-reviewable keep-Firma or migrate-Documenso recommendation.
- Consumes: Firma acceptance results and the Documenso pilot matrix.

- [ ] **Step 1: Write the comparison with measured values**

Include exact results for PDF fidelity, individual/couple signing, email delivery, webhook security, duplicate handling, evidence, restore time, monthly infrastructure, operator hours, licensing review, and unresolved defects. Mark every unverified claim explicitly.

- [ ] **Step 2: Apply the mandatory decision rules**

Recommend keeping Firma unless Documenso passes every mandatory criterion in the spec. A cost advantage alone is insufficient. Do not set `DOCUMENSO_PRODUCTION_ENABLED=true` in this task.

- [ ] **Step 3: Run final repository verification**

Run:

```bash
npx vitest run tests/esign-provider-contract.test.ts tests/esign-provider-migration.test.ts tests/esign-webhook-adapters.test.ts tests/esign-artifacts.test.ts tests/engagement-esign-actions.test.ts tests/esign-reconciliation.test.ts tests/firma-webhook-route.test.ts tests/documenso-provider.test.ts tests/documenso-webhook.test.ts
npm run lint
npm run typecheck
npm test
npm run build
git diff --check
```

Expected: focused e-sign tests PASS. Report any unrelated baseline failures separately and do not describe the release as green unless build and relevant authorization/document tests pass.

- [ ] **Step 4: Commit the decision artifact**

```bash
git add docs/integrations/esign-provider-decision.md OPERATIONS_RUNBOOK.md
git commit -m "docs: record e-sign provider decision"
```

---

## Release Boundaries

The work has three independent release gates:

1. **Firma enhancement release:** Tasks 1–7 may ship after focused automated checks, individual/couple visual acceptance, webhook verification, and signed-evidence retention pass.
2. **Documenso staging release:** Task 8 may deploy only to staging with synthetic data.
3. **Production provider decision:** Task 9 produces a recommendation only. A Documenso production migration requires a new approved design and implementation plan covering data migration, DNS/routing, rollback, uptime, credential rotation, and client communications.
