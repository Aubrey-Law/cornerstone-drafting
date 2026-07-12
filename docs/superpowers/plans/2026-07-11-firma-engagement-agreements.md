# Firma Engagement Agreements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed Firma individual/couple templates with reviewed, matter-specific DOCX engagement agreements while retaining the current lead conversion, direct-signing, webhook, signed-document storage, and status workflows, then expose the same service through a narrow MCP interface.

**Architecture:** Three controlled DOCX masters (`EP`, `EP-LP`, and `Probate`) render editable agreements, then Cornerstone's existing LibreOffice worker converts them to immutable US Letter signing PDFs. A provider-neutral agreement service owns authorization, revisions, recipients, PDF-bound approval, and lifecycle state; Firma receives PDFs with invisible searchable anchors. MCP calls the same service only after the standard application workflow ships.

**Tech Stack:** Next.js App Router, TypeScript, React, Supabase/Postgres with RLS, `docxtemplater`, `pizzip`, `@firma-dev/sdk`, Cloudflare R2, Vitest, MCP Streamable HTTP transport.

## Global Constraints

- Do not modify Cornerstone estate drafting internals: design sheet, generate, review, draft payload, or estate generator.
- Only clients sign: one signer for an individual and two signers for a couple.
- Practice areas are exactly `EP`, `EP-LP`, and `Probate`.
- `EP-LP` plans are exactly `MetLife`, `LegalEase`, and `ARAG`; MetLife and LegalEase share substantive language while ARAG substitutes approved clauses.
- Support structured agreement changes only; do not build a free-form browser word processor.
- Sent revisions are immutable, and sending requires approval bound to the exact rendered revision.
- Keep the Firma API key and webhook secrets server-only.
- Preserve active legacy envelopes until they finish or are explicitly reconciled.
- Do not remove the Firma template editor until document-based sending passes end-to-end verification.
- Each task must finish green independently; existing baseline failures documented in `AGENTS.md` are not regressions.

---

## File Structure

New agreement-domain files live under `lib/engagement/`:

- `types.ts` — stable domain types and enums.
- `schema.ts` — structured-input normalization and validation.
- `definitions.ts` — practice-area defaults and conditional model selection.
- `render.ts` — deterministic DOCX rendering, PDF conversion/validation, and PDF revision hashing.
- `repository.ts` — Supabase persistence only.
- `service.ts` — authorization-independent business orchestration called by authenticated routes and MCP.
- `approval.ts` — short-lived revision-bound confirmation tokens.

Firma-specific code remains under `lib/esign/`. The dedicated workspace lives under `app/admin/engagements/[agreementId]/` with focused components under `components/engagement/`. Lead and matter entry points create/resume a draft and navigate to the workspace; common behavior is delegated to the service.

---

### Task 1: Lock Current Engagement Behavior with Regression Tests

**Files:**
- Modify: `tests/engagement-send.test.ts`
- Modify: `tests/esign.test.ts`
- Create: `tests/engagement-current-flow.test.ts`
- Read: `app/api/admin/leads/[id]/engagement/route.ts`
- Read: `app/api/admin/matters/[id]/engagement/route.ts`
- Read: `app/api/webhooks/esign/route.ts`
- Read: `lib/esign/firma.ts`

**Interfaces:**
- Consumes: current `EsignProvider.createEngagementEnvelope`, lead/matter route contracts, and webhook storage flow.
- Produces: executable characterization coverage that must remain green through Tasks 2–8.

- [ ] **Step 1: Add focused source-shape characterization tests**

Create `tests/engagement-current-flow.test.ts` with assertions that the current flow includes both send routes, spouse handling, lead conversion, provider re-fetch, R2 upload, and matter-document insertion:

```ts
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')
const leadRoute = read('app/api/admin/leads/[id]/engagement/route.ts')
const matterRoute = read('app/api/admin/matters/[id]/engagement/route.ts')
const webhook = read('app/api/webhooks/esign/route.ts')

describe('current engagement flow contract', () => {
  it('supports primary and spouse signers from leads and matters', () => {
    expect(leadRoute).toContain('spouseEmail')
    expect(matterRoute).toContain('spouse_email')
    expect(leadRoute).toContain('createEngagementEnvelope')
    expect(matterRoute).toContain('createEngagementEnvelope')
  })

  it('converts signed leads and stores the completed PDF', () => {
    expect(webhook).toContain('createMatterFromIntake')
    expect(webhook).toContain('putFileToR2')
    expect(webhook).toContain("from('matter_documents').insert")
    expect(webhook).toContain('getEnvelopeState')
  })
})
```

- [ ] **Step 2: Run characterization tests**

Run:

```bash
npx vitest run tests/engagement-current-flow.test.ts tests/engagement-send.test.ts tests/esign.test.ts
```

Expected: all selected tests pass on current `main`.

- [ ] **Step 3: Commit the baseline**

```bash
git add tests/engagement-current-flow.test.ts tests/engagement-send.test.ts tests/esign.test.ts
git commit -m "test: lock current engagement workflow"
```

---

### Task 2: Prove Firma DOCX, Anchors, Downloads, and Webhooks

**Files:**
- Create: `scripts/firma-engagement-poc.mjs`
- Create: `docs/integrations/firma-engagement-poc.md`
- Modify: `.gitignore`
- Modify: `VERCEL_ENV_CHECKLIST.md`

**Interfaces:**
- Consumes: `FIRMA_API_KEY`, a non-production Firma workspace, and a supplied disposable DOCX containing the documented anchor markers.
- Produces: confirmed request payload fields, anchor syntax, webhook headers, completion response, and download/audit behavior used verbatim in Tasks 6 and 7.

- [ ] **Step 1: Add a guarded proof-of-concept script**

Create a script that refuses production execution, reads `FIRMA_POC_DOCX`, base64-encodes it, and calls the document-based signing-request endpoint without sending unless `FIRMA_POC_SEND=true`:

```js
import fs from 'node:fs/promises'

const apiKey = process.env.FIRMA_API_KEY
const docxPath = process.env.FIRMA_POC_DOCX
const recipientEmail = process.env.FIRMA_POC_RECIPIENT_EMAIL
if (!apiKey || !docxPath || !recipientEmail) throw new Error('Missing POC environment')
if (!recipientEmail.endsWith('@example.com') && process.env.FIRMA_POC_ALLOW_REAL !== 'true') {
  throw new Error('Refusing a real recipient without FIRMA_POC_ALLOW_REAL=true')
}

const document = (await fs.readFile(docxPath)).toString('base64')
const response = await fetch(
  'https://api.firma.dev/functions/v1/signing-request-api/signing-requests',
  {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Cornerstone engagement POC',
      document,
      recipients: [{ id: 'temp_1', first_name: 'Test', last_name: 'Client', email: recipientEmail, designation: 'Signer', order: 1 }],
      anchor_tags: [
        { anchor: '[[CLIENT_1_SIGNATURE]]', type: 'signature', recipient_id: 'temp_1', required: true },
        { anchor: '[[CLIENT_1_DATE]]', type: 'date', recipient_id: 'temp_1', required: true, date_signing_default: true },
      ],
    }),
  },
)
const body = await response.json()
if (!response.ok) throw new Error(JSON.stringify(body))
console.log(JSON.stringify({ id: body.id, recipients: body.recipients, status: body.status }, null, 2))
```

- [ ] **Step 2: Ignore local POC artifacts**

Append these exact patterns to `.gitignore`:

```gitignore
.firma-poc/
firma-webhook-captures/
```

- [ ] **Step 3: Execute the POC against a Firma test workspace**

Run:

```bash
node scripts/firma-engagement-poc.mjs
```

Expected: a created, unsent request ID and recipient data. Then, with an authorized disposable recipient, set `FIRMA_POC_SEND=true`, send through the documented send endpoint, complete signing, and capture redacted webhook headers/body, completed-document retrieval, and audit retrieval.

- [ ] **Step 4: Record exact verified contracts**

In `docs/integrations/firma-engagement-poc.md`, record the tested Firma API version, exact accepted `anchor_tags` object shape, whether anchors are removed from the rendered PDF, two-signer ordering, webhook signature headers, event ID location, completed-document field/endpoint, and audit field/endpoint. Include no API keys, tokens, client data, or signing links.

- [ ] **Step 5: Add confirmed environment requirements**

Update `VERCEL_ENV_CHECKLIST.md` with only the verified server secrets. Do not add `FIRMA_ENGAGEMENT_TEMPLATE_ID` or `_JOINT` as requirements for the new flow.

- [ ] **Step 6: Commit the proof**

```bash
git add scripts/firma-engagement-poc.mjs docs/integrations/firma-engagement-poc.md .gitignore VERCEL_ENV_CHECKLIST.md
git commit -m "docs: verify Firma document signing contract"
```

---

### Task 3: Add Agreement Domain Types and Structured Validation

**Files:**
- Create: `lib/engagement/types.ts`
- Create: `lib/engagement/schema.ts`
- Create: `lib/engagement/definitions.ts`
- Create: `tests/engagement-schema.test.ts`

**Interfaces:**
- Consumes: canonical practice-area values and user-approved plan variants.
- Produces: `EngagementInput`, `EngagementRecipientInput`, `normalizeEngagementInput`, `validateEngagementInput`, and `agreementDefinitionFor`.

- [ ] **Step 1: Write failing domain tests**

Cover all valid combinations and failures:

```ts
import { describe, expect, it } from 'vitest'
import { validateEngagementInput } from '@/lib/engagement/schema'

const base = {
  practiceArea: 'EP' as const,
  clientMode: 'individual' as const,
  agreementDate: '2026-07-11',
  primary: { name: 'Alex Client', email: 'alex@example.com' },
  spouse: null,
  legalPlan: null,
  fee: { amount: 5000, paymentTerms: 'Due on signing' },
  scopeKey: 'standard',
  optionalClauseKeys: [],
  emailMessage: 'Please review and sign.',
  expirationHours: 168,
}

describe('validateEngagementInput', () => {
  it('accepts an individual EP agreement', () => {
    expect(validateEngagementInput(base).ok).toBe(true)
  })

  it('requires spouse name and email for couples', () => {
    const result = validateEngagementInput({ ...base, clientMode: 'couple' })
    expect(result).toMatchObject({ ok: false, errors: expect.arrayContaining(['spouse']) })
  })

  it('requires a recognized legal plan for EP-LP', () => {
    const result = validateEngagementInput({ ...base, practiceArea: 'EP-LP' })
    expect(result).toMatchObject({ ok: false, errors: expect.arrayContaining(['legalPlan']) })
  })
})
```

- [ ] **Step 2: Verify tests fail**

```bash
npx vitest run tests/engagement-schema.test.ts
```

Expected: FAIL because the engagement modules do not exist.

- [ ] **Step 3: Define stable domain types**

In `types.ts`, define exact unions and interfaces:

```ts
export type EngagementPracticeArea = 'EP' | 'EP-LP' | 'Probate'
export type EngagementClientMode = 'individual' | 'couple'
export type EngagementLegalPlan = 'MetLife' | 'LegalEase' | 'ARAG'
export type EngagementStatus = 'draft' | 'ready' | 'sent' | 'viewed' | 'partially_signed' | 'completed' | 'cancelled' | 'expired' | 'failed'

export interface EngagementRecipientInput { name: string; email: string }
export interface EngagementInput {
  practiceArea: EngagementPracticeArea
  clientMode: EngagementClientMode
  agreementDate: string
  primary: EngagementRecipientInput
  spouse: EngagementRecipientInput | null
  legalPlan: EngagementLegalPlan | null
  fee: { amount: number; paymentTerms: string }
  scopeKey: string
  optionalClauseKeys: string[]
  emailMessage: string
  expirationHours: number
}
```

- [ ] **Step 4: Implement normalization, validation, and definitions**

Implement `validateEngagementInput(input): { ok: true; value: EngagementInput } | { ok: false; errors: string[] }`. Normalize emails to lowercase, trim names/text, require an ISO date, positive finite fee, expiration of at least one hour, spouse data for couples, null spouse for individuals, a legal plan only for `EP-LP`, and allowlisted scope/clause keys returned by `agreementDefinitionFor(practiceArea, legalPlan)`.

- [ ] **Step 5: Run domain tests**

```bash
npx vitest run tests/engagement-schema.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the domain**

```bash
git add lib/engagement/types.ts lib/engagement/schema.ts lib/engagement/definitions.ts tests/engagement-schema.test.ts
git commit -m "feat: define engagement agreement inputs"
```

---

### Task 4: Convert Three DOCX Masters and Build Deterministic Rendering

**Files:**
- Create: `assets/engagement-agreements/ep.docx`
- Create: `assets/engagement-agreements/ep-lp.docx`
- Create: `assets/engagement-agreements/probate.docx`
- Create: `lib/engagement/render.ts`
- Create: `tests/engagement-render.test.ts`
- Create: `tests/fixtures/engagement/*.txt`

**Interfaces:**
- Consumes: `EngagementInput` and the six attorney-supplied Word agreements.
- Produces: `renderEngagementAgreement(input): Promise<{ docxBytes: Buffer; pdfBytes: Buffer; pdfSha256: string; masterKey: string; masterVersion: string }>`.

- [ ] **Step 1: Reconcile the six Word documents**

Create a clause comparison for each practice area. Preserve the approved legal language exactly. Encode individual/couple blocks with docxtemplater conditions, use `legal_plan_display` for MetLife/LegalEase, and use `is_arag` only around the identified ARAG substitutions. Insert these exact anchors in the signature blocks and format their Word runs white so they remain searchable but invisible in the converted PDF:

```text
[[CLIENT_1_SIGNATURE]]
[[CLIENT_1_DATE]]
[[CLIENT_2_SIGNATURE]]
[[CLIENT_2_DATE]]
```

The client-two block must be conditional so individual output contains no client-two anchors.

- [ ] **Step 2: Write failing rendering tests**

Test each practice area and client mode, plan variants, absence of unresolved `{...}` tags, one versus two anchor sets, deterministic hash for identical input, and different hash after a fee or clause change. Extract rendered DOCX text using the existing ZIP/XML test technique rather than visual snapshots alone.

- [ ] **Step 3: Verify tests fail**

```bash
npx vitest run tests/engagement-render.test.ts
```

Expected: FAIL because `renderEngagementAgreement` does not exist.

- [ ] **Step 4: Implement rendering**

Use `PizZip` and `Docxtemplater`, then call the existing `convertDocxToPdf`. Validate US Letter page dimensions and required anchor cardinality, and compute the approval SHA-256 over the PDF bytes:

```ts
export async function renderEngagementAgreement(input: EngagementInput) {
  const template = await fs.readFile(masterPath(input.practiceArea))
  const zip = new PizZip(template)
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true })
  doc.render(toAgreementContext(input))
  const docxBytes = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' })
  const pdfBytes = await convertDocxToPdf(docxBytes, 'engagement-agreement.docx')
  await validateSigningPdf(pdfBytes, input.clientMode)
  return {
    docxBytes,
    pdfBytes,
    pdfSha256: createHash('sha256').update(pdfBytes).digest('hex'),
    masterKey: input.practiceArea.toLowerCase(),
    masterVersion: '1',
  }
}
```

- [ ] **Step 5: Render and visually inspect all variants**

Generate `EP`, `EP-LP` MetLife, LegalEase, ARAG, and Probate in individual and couple modes. Open the DOCX/PDF conversions and compare page flow, conditional language, headers, fees, and signature blocks against the six source agreements. Record legal approval in the commit/PR evidence; do not infer approval from passing tests.

- [ ] **Step 6: Run rendering tests**

```bash
npx vitest run tests/engagement-render.test.ts tests/engagement-schema.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit masters and renderer**

```bash
git add assets/engagement-agreements lib/engagement/render.ts tests/engagement-render.test.ts tests/fixtures/engagement
git commit -m "feat: render conditional engagement agreements"
```

---

### Task 5: Add Revision, Recipient, Approval, and Legacy Persistence

**Files:**
- Create: `supabase/migrations/20260728000000_lite_engagement_agreements.sql`
- Create: `lib/engagement/repository.ts`
- Create: `lib/engagement/approval.ts`
- Create: `tests/engagement-repository.test.ts`
- Create: `tests/engagement-approval.test.ts`
- Modify: `types/database.ts`

**Interfaces:**
- Consumes: validated inputs and renderer output.
- Produces: `createAgreementDraft`, `createAgreementRevision`, `getAgreement`, `claimAgreementSend`, `recordFirmaRequest`, `recordRecipientState`, `completeAgreement`, `issueRevisionApproval`, and `verifyRevisionApproval`.

- [ ] **Step 1: Write failing migration and approval tests**

Assert the migration defines `engagement_agreements`, `engagement_agreement_revisions`, `engagement_agreement_recipients`, and `firma_webhook_events`; enforces exactly one of `matter_id`/`lead_id`; prevents duplicate Firma request IDs and event IDs; enables RLS; and includes staff read/write policies. Test that approval tokens are signed, expire, are bound to agreement ID plus revision hash, and reject changed hashes.

- [ ] **Step 2: Verify tests fail**

```bash
npx vitest run tests/engagement-repository.test.ts tests/engagement-approval.test.ts
```

Expected: FAIL because the migration and modules do not exist.

- [ ] **Step 3: Add normalized schema**

The migration must include:

```sql
create table public.engagement_agreements (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid references public.matters(id) on delete cascade,
  lead_id uuid references public.client_intake(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','ready','sent','viewed','partially_signed','completed','cancelled','expired','failed')),
  active_revision_id uuid,
  firma_request_id text unique,
  legacy_envelope_id text,
  prepared_by uuid references auth.users(id),
  sent_by uuid references auth.users(id),
  sent_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((matter_id is not null)::int + (lead_id is not null)::int = 1)
);
```

Add revision JSON snapshots, render hashes/master versions, R2 keys, recipient order/status timestamps, and webhook event IDs. Add foreign keys only after both referenced tables exist, then reload PostgREST.

- [ ] **Step 4: Implement repository and approvals**

Repository methods accept an injected Supabase client and never instantiate auth/admin clients themselves. `claimAgreementSend` performs an atomic `ready -> sending` claim through an RPC or conditional update. Approval tokens use HMAC SHA-256 with `ENGAGEMENT_APPROVAL_SECRET`, include agreement ID, revision ID, SHA-256, expiry, and a nonce, and are consumed by the atomic send claim.

- [ ] **Step 5: Run persistence tests**

```bash
npx vitest run tests/engagement-repository.test.ts tests/engagement-approval.test.ts
```

Expected: PASS.

- [ ] **Step 6: Apply migration locally and inspect schema**

```bash
npx supabase db reset
```

Expected: migration applies without error; existing seed data loads; PostgREST exposes the four new tables.

- [ ] **Step 7: Commit persistence**

```bash
git add supabase/migrations/20260728000000_lite_engagement_agreements.sql lib/engagement/repository.ts lib/engagement/approval.ts tests/engagement-repository.test.ts tests/engagement-approval.test.ts types/database.ts
git commit -m "feat: persist engagement agreement revisions"
```

---

### Task 6: Refactor Firma to Send Rendered DOCX Requests

**Files:**
- Modify: `lib/esign/types.ts`
- Modify: `lib/esign/firma.ts`
- Create: `lib/engagement/service.ts`
- Create: `tests/firma-document-request.test.ts`
- Create: `tests/engagement-service.test.ts`

**Interfaces:**
- Consumes: verified Task 2 Firma contract, renderer, repository, and approval verifier.
- Produces: `prepareAgreement`, `previewAgreement`, `approveAgreementRevision`, `sendApprovedAgreement`, and an e-sign provider document-request method.

- [ ] **Step 1: Write failing provider and service tests**

Mock Firma and assert PDF bytes—not DOCX bytes or `template_id`—are sent; temporary recipient IDs map to confirmed anchor definitions; individual output has one recipient; couple output has two ordered recipients; stale approvals fail before Firma is called; duplicate sends return the existing request; and the external request ID is persisted.

- [ ] **Step 2: Verify tests fail**

```bash
npx vitest run tests/firma-document-request.test.ts tests/engagement-service.test.ts
```

Expected: FAIL because the provider only supports template envelopes and the service does not exist.

- [ ] **Step 3: Evolve the provider contract**

Add a provider input that does not expose Firma-specific names:

```ts
export interface EsignDocumentRequestInput {
  name: string
  document: Buffer
  recipients: Array<{ key: string; name: string; email: string; order: number }>
  anchors: Array<{ marker: string; type: 'signature' | 'date'; recipientKey: string; required: boolean; dateSigningDefault?: boolean }>
  expirationHours: number
  customMessage: string
}

export interface EsignDocumentRequestResult {
  requestId: string
  recipients: Array<{ key: string; externalId: string; signingLink: string | null }>
}
```

Replace the new-flow call with `createDocumentRequest(input)` and `sendDocumentRequest(requestId, customMessage)`. Keep legacy `createEngagementEnvelope` temporarily for active old routes until Task 8 cuts them over.

- [ ] **Step 4: Implement service orchestration**

`prepareAgreement` validates and persists a draft. `previewAgreement` renders and stores a new immutable revision. `approveAgreementRevision` issues a token only for the current revision. `sendApprovedAgreement` verifies the token, claims the send atomically, creates a Firma document request, persists request/recipient IDs, sends it, and records `sent`. On create failure, release the claim to `ready`; on ambiguous send failure, reconcile Firma state before retrying.

- [ ] **Step 5: Run provider and service tests**

```bash
npx vitest run tests/firma-document-request.test.ts tests/engagement-service.test.ts tests/engagement-current-flow.test.ts
```

Expected: PASS, including the legacy characterization test.

- [ ] **Step 6: Commit the service**

```bash
git add lib/esign/types.ts lib/esign/firma.ts lib/engagement/service.ts tests/firma-document-request.test.ts tests/engagement-service.test.ts
git commit -m "feat: send rendered agreements through Firma"
```

---

### Task 7: Upgrade Firma Webhooks and Preserve Completion Workflows

**Files:**
- Modify: `app/api/webhooks/esign/route.ts`
- Modify: `lib/esign/verify.ts`
- Create: `lib/engagement/webhook.ts`
- Create: `tests/firma-webhook-signature.test.ts`
- Modify: `tests/esign.test.ts`

**Interfaces:**
- Consumes: verified Task 2 webhook headers/event shape, repository, current lead conversion, and current R2 storage behavior.
- Produces: `verifyFirmaWebhook(rawBody, headers)`, `processFirmaWebhookEvent`, idempotent recipient/agreement transitions, and preserved signed-PDF storage.

- [ ] **Step 1: Write failing HMAC and lifecycle tests**

Test current signature acceptance, old-signature acceptance during rotation, invalid rejection, timing-safe comparison, duplicate event acknowledgement, viewed status, one-of-two partial signature, completion, unknown request acknowledgement, lead conversion, and exactly-once matter-document insertion.

- [ ] **Step 2: Verify tests fail**

```bash
npx vitest run tests/firma-webhook-signature.test.ts tests/esign.test.ts
```

Expected: FAIL because the current route authenticates via a query-string secret and has no event table.

- [ ] **Step 3: Implement raw-body verification**

Using the confirmed headers from Task 2, compute the expected hex digest over the untouched request body:

```ts
export function verifyFirmaSignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(signature, 'hex')
  const b = Buffer.from(expected, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}
```

Check the current secret first and the documented old signature/old secret only during rotation. Remove the secret query parameter after cutover.

- [ ] **Step 4: Extract lifecycle processing**

Store the event ID before processing with a uniqueness constraint. Re-fetch authoritative Firma request state. Update recipients, derive aggregate status, convert signed leads through `createMatterFromIntake`, retrieve the completed PDF/audit result, and reuse the existing R2/matter-document behavior. Make document insertion identifiable by agreement ID so a retry cannot duplicate it.

- [ ] **Step 5: Run webhook tests**

```bash
npx vitest run tests/firma-webhook-signature.test.ts tests/esign.test.ts tests/engagement-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit webhook hardening**

```bash
git add app/api/webhooks/esign/route.ts lib/esign/verify.ts lib/engagement/webhook.ts tests/firma-webhook-signature.test.ts tests/esign.test.ts
git commit -m "feat: secure Firma engagement webhooks"
```

---

### Task 8: Add the Five-Step Engagement Workspace

**Files:**
- Create: `components/engagement/EngagementAgreementStatus.tsx`
- Create: `app/admin/engagements/[agreementId]/page.tsx`
- Create: `app/admin/engagements/[agreementId]/EngagementWorkspace.tsx`
- Create: `components/engagement/EngagementStepNavigation.tsx`
- Create: `components/engagement/EngagementDetailsStep.tsx`
- Create: `components/engagement/EngagementTermsStep.tsx`
- Create: `components/engagement/EngagementReviewStep.tsx`
- Create: `components/engagement/EngagementSendStep.tsx`
- Create: `components/engagement/EngagementStatusStep.tsx`
- Create: `app/api/admin/engagement-agreements/[id]/route.ts`
- Create: `app/api/admin/engagement-agreements/[id]/preview/route.ts`
- Create: `app/api/admin/engagement-agreements/[id]/approve/route.ts`
- Create: `app/api/admin/engagement-agreements/[id]/send/route.ts`
- Modify: `app/api/admin/leads/[id]/engagement/route.ts`
- Modify: `app/api/admin/matters/[id]/engagement/route.ts`
- Modify: `app/admin/leads/SendEngagementDialog.tsx`
- Modify: `app/admin/matters/[id]/MatterEssentialsCard.tsx`
- Create: `tests/engagement-routes.test.ts`
- Create: `tests/engagement-dialog.test.tsx`

**Interfaces:**
- Consumes: agreement service and authenticated lead/matter context.
- Produces: a dedicated Details → Terms → Review → Send → Status workflow and a stable HTTP boundary later reused by MCP adapters.

- [ ] **Step 1: Write failing route and UI tests**

Test admin authorization; matter/lead ownership lookup; draft create/resume; stable step routing; default practice area and spouse mode; required `EP-LP` plan; structured autosave; review blockers; DOCX/PDF preview downloads; approval token issuance; explicit send confirmation; stale revision rejection after edits; direct signing link display; per-recipient status; and signed resend rejection.

- [ ] **Step 2: Verify tests fail**

```bash
npx vitest run tests/engagement-routes.test.ts tests/engagement-dialog.test.tsx
```

Expected: FAIL because the new routes/components do not exist.

- [ ] **Step 3: Implement authenticated agreement routes**

All routes call `requireAdmin`, resolve the scoped agreement, and delegate to `lib/engagement/service.ts`. The preview route returns the DOCX with:

```ts
return new Response(bytes, {
  headers: {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'Content-Disposition': `attachment; filename="${filename}"`,
    ETag: `"${sha256}"`,
  },
})
```

- [ ] **Step 4: Implement the dedicated workspace shell**

Create `/admin/engagements/[agreementId]` with five stable steps: Details, Terms, Review, Send, and Status. Reuse the drafting workspace's interaction principles—left-side step navigation, autosave state, completion indicators, blocker links, and final review—but do not import drafting state or modify files under `app/admin/drafting`. Persist the active step in the URL so refresh/back navigation is stable.

- [ ] **Step 5: Implement Details and Terms**

Details shows practice area, individual/couple, signer names/emails, agreement date, responsible attorney, and legal plan only for `EP-LP`. Terms shows fee, payment terms, scope, included/excluded services, allowlisted optional clauses, message, and expiration. Autosave only validated structured fields and mark any post-review signing-relevant change as requiring regeneration.

- [ ] **Step 6: Implement Review, Send, and Status**

Review displays the exact signing PDF plus structured-change summary and blockers. Send repeats signer identities and PDF checksum/revision, requires explicit reviewed-document confirmation, and disables on stale state. Status shows overall/per-recipient state, audit activity, completed downloads, resend, cancel, and expiration.

- [ ] **Step 7: Cut existing entry points over**

Keep the existing lead and matter buttons/locations, but create or resume the scoped draft and navigate to `/admin/engagements/[agreementId]`. Preserve pre-matter sending and direct **Sign now** links. Stop calling `createEngagementEnvelope` from the two old routes; convert them to draft-create/resume compatibility endpoints or return the new agreement resource.

- [ ] **Step 8: Run focused UI/API tests**

```bash
npx vitest run tests/engagement-routes.test.ts tests/engagement-dialog.test.tsx tests/engagement-current-flow.test.ts tests/engagement-send.test.ts
```

Expected: PASS after updating characterization assertions to the new service while retaining the business outcomes.

- [ ] **Step 9: Run typecheck and scoped lint**

```bash
npx tsc --noEmit --project tsconfig.json
npx eslint components/engagement 'app/admin/engagements/[agreementId]' app/api/admin/engagement-agreements lib/engagement app/admin/leads/SendEngagementDialog.tsx 'app/admin/matters/[id]/MatterEssentialsCard.tsx'
```

Expected: no new errors. If repository-wide test type errors remain, compare them to the documented baseline and record them rather than weakening checks.

- [ ] **Step 10: Commit the application workflow**

```bash
git add components/engagement 'app/admin/engagements/[agreementId]' app/api/admin/engagement-agreements app/api/admin/leads app/api/admin/matters app/admin/leads/SendEngagementDialog.tsx 'app/admin/matters/[id]/MatterEssentialsCard.tsx' tests/engagement-routes.test.ts tests/engagement-dialog.test.tsx tests/engagement-current-flow.test.ts tests/engagement-send.test.ts
git commit -m "feat: add reviewed engagement agreement workflow"
```

**Release boundary:** Tasks 1–8 produce a complete production feature without MCP.

---

### Task 9: Migrate Legacy State and Remove the Firma Template Editor

**Files:**
- Create: `supabase/migrations/20260728000001_migrate_legacy_engagements.sql`
- Delete: `app/admin/settings/EsignTemplateEditor.tsx`
- Delete: `app/api/admin/esign/template-token/route.ts`
- Delete: `tests/esign-template-token.test.ts`
- Modify: `app/admin/settings/StaffSettingsClient.tsx`
- Modify: `lib/esign/firma.ts`
- Modify: `VERCEL_ENV_CHECKLIST.md`
- Create: `tests/engagement-legacy-migration.test.ts`

**Interfaces:**
- Consumes: deployed document-based workflow, active legacy envelope inventory, and new persistence.
- Produces: reconciled historical rows and removal of fixed-template maintenance.

- [ ] **Step 1: Inventory active legacy requests**

Before migration, query non-null legacy envelope IDs whose status is not terminal (`signed`, `declined`, `cancelled`, or `expired`). Export only IDs/status/timestamps to a protected operational record; do not export agreement documents or client PII.

- [ ] **Step 2: Write failing migration/removal tests**

Assert the migration creates one legacy-linked agreement per existing envelope without overwriting newer records, and assert no tracked source references `EsignTemplateEditor`, `generateEngagementTemplateToken`, `FIRMA_ENGAGEMENT_TEMPLATE_ID`, `FIRMA_ENGAGEMENT_TEMPLATE_ID_JOINT`, or `template-editor.js` after removal.

- [ ] **Step 3: Verify tests fail**

```bash
npx vitest run tests/engagement-legacy-migration.test.ts tests/esign-template-token.test.ts
```

Expected: FAIL because the editor and template variables still exist.

- [ ] **Step 4: Migrate legacy envelope references**

Insert idempotently from `matter_details` and `client_intake`, map `signed` to `completed`, retain other statuses conservatively, store the old envelope as both `legacy_envelope_id` and `firma_request_id` where unique, and leave old columns readable during one release for rollback/reconciliation.

- [ ] **Step 5: Remove editor-only code and configuration**

Delete the editor component, JWT route, token generator, settings tab, source-shape test, and both template-ID requirements. Keep `FIRMA_API_KEY`, verified webhook secrets, document-request methods, state reconciliation, and legacy lookup until the operational inventory is terminal.

- [ ] **Step 6: Run migration/removal and regression tests**

```bash
npx vitest run tests/engagement-legacy-migration.test.ts tests/engagement-current-flow.test.ts tests/engagement-service.test.ts tests/firma-webhook-signature.test.ts
```

Expected: PASS and no editor/template-ID references.

- [ ] **Step 7: Commit cutover cleanup**

```bash
git add -A app/admin/settings app/api/admin/esign lib/esign tests/esign-template-token.test.ts tests/engagement-legacy-migration.test.ts supabase/migrations/20260728000001_migrate_legacy_engagements.sql VERCEL_ENV_CHECKLIST.md
git commit -m "refactor: retire fixed Firma engagement templates"
```

---

### Task 10: Expose the Proven Service Through Cornerstone MCP

**Files:**
- Create: `app/api/mcp/route.ts`
- Create: `lib/mcp/auth.ts`
- Create: `lib/mcp/engagementTools.ts`
- Create: `tests/mcp-engagement-tools.test.ts`
- Modify: `README.md`
- Modify: `VERCEL_ENV_CHECKLIST.md`

**Interfaces:**
- Consumes: `prepareAgreement`, `getAgreement`, structured update/preview/approval/send operations, and the same staff authorization rules as the UI.
- Produces: Streamable HTTP MCP tools with stable matter/agreement IDs and revision-bound send confirmation.

- [ ] **Step 1: Choose and document MCP authentication before code**

Use staff-scoped OAuth/OIDC or short-lived signed tokens accepted by Cornerstone. Do not accept the Firma API key, Supabase service-role key, or an unauthenticated public endpoint. Document issuer, audience, scopes, token lifetime, and revocation behavior in `README.md` and environment requirements.

- [ ] **Step 2: Write failing MCP contract tests**

Test authentication, matter authorization, exact JSON schemas, unknown-field rejection, read-only status behavior, revision approval, explicit confirmation, stale confirmation rejection, duplicate send handling, and audit attribution to the authenticated staff user.

- [ ] **Step 3: Verify tests fail**

```bash
npx vitest run tests/mcp-engagement-tools.test.ts
```

Expected: FAIL because the MCP endpoint/tools do not exist.

- [ ] **Step 4: Implement narrow tool schemas**

Expose exactly:

```ts
export const engagementToolNames = [
  'engagement_agreements_prepare',
  'engagement_agreements_get',
  'engagement_agreements_update_structured_fields',
  'engagement_agreements_preview',
  'engagement_agreements_approve_revision',
  'engagement_agreements_send',
  'engagement_agreements_status',
  'engagement_agreements_cancel',
  'engagement_agreements_resend',
] as const
```

Every mutating tool requires a stable matter/agreement ID. `send` additionally requires the approval token returned for the exact revision. Do not expose arbitrary document text, raw SQL, generic Firma tools, template administration, or API credentials.

- [ ] **Step 5: Implement Streamable HTTP handling and auth**

Authenticate before MCP request dispatch, create a user-scoped Supabase client or pass a verified staff principal into the service, reject missing scopes, and include staff ID plus MCP client metadata in activity records.

- [ ] **Step 6: Run MCP and service tests**

```bash
npx vitest run tests/mcp-engagement-tools.test.ts tests/engagement-service.test.ts tests/engagement-approval.test.ts
```

Expected: PASS.

- [ ] **Step 7: Verify with an MCP client**

Connect Codex to the staging MCP URL. Prepare a disposable agreement, update a structured fee field, preview it, attempt a stale send and confirm rejection, approve the current revision, send to an authorized disposable recipient, and check status. Confirm the same agreement appears correctly in Cornerstone.

- [ ] **Step 8: Commit MCP**

```bash
git add app/api/mcp/route.ts lib/mcp/auth.ts lib/mcp/engagementTools.ts tests/mcp-engagement-tools.test.ts README.md VERCEL_ENV_CHECKLIST.md
git commit -m "feat: expose engagement agreements over MCP"
```

---

### Task 11: Full Verification and Release Evidence

**Files:**
- Modify: `docs/integrations/firma-engagement-poc.md`
- Modify: `OPERATIONS_RUNBOOK.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: verified release checklist, rollback procedure, and operator instructions.

- [ ] **Step 1: Run focused feature suite**

```bash
npx vitest run tests/engagement-schema.test.ts tests/engagement-render.test.ts tests/engagement-repository.test.ts tests/engagement-approval.test.ts tests/firma-document-request.test.ts tests/engagement-service.test.ts tests/firma-webhook-signature.test.ts tests/engagement-routes.test.ts tests/engagement-dialog.test.tsx tests/engagement-legacy-migration.test.ts tests/mcp-engagement-tools.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 2: Run project checks**

```bash
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: feature tests and build pass. Compare repository-wide test/typecheck/lint results with the explicit baseline in `AGENTS.md`; document only unchanged baseline failures and fix every new failure.

- [ ] **Step 3: Perform staging matrix**

Create and inspect all ten variants: `EP` individual/couple, `Probate` individual/couple, and each of the three `EP-LP` plans in individual/couple mode. Verify structured fee/scope changes, DOCX preview, anchors, emails, direct signing, partial couple completion, final completion, lead conversion, R2 storage, matter document, status, cancellation, resend, expiration, and MCP parity.

- [ ] **Step 4: Document operations and rollback**

Update `OPERATIONS_RUNBOOK.md` with master publishing/versioning, Firma secrets, webhook registration/rotation, failed-send reconciliation, legacy-envelope reconciliation, template-editor removal, MCP credential rotation, and rollback to read-only legacy tracking without re-enabling fixed-template sends.

- [ ] **Step 5: Commit verification documentation**

```bash
git add docs/integrations/firma-engagement-poc.md OPERATIONS_RUNBOOK.md
git commit -m "docs: add engagement agreement operations"
```
