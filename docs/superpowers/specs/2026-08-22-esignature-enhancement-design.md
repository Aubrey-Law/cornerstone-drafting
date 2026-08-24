# E-Signature Enhancement Design

## Objective

Improve Cornerstone's engagement-agreement signing workflow without replacing a working provider prematurely. The project completes the existing Firma lifecycle, removes Firma-specific persistence and webhook coupling, and adds a staging-only Documenso self-hosted implementation for an evidence-based provider decision.

This design covers ordinary engagement agreements only. It does not authorize electronic execution of wills, health-care proxies, powers requiring witnesses or notarization, or final estate-plan execution packets.

## Selected Direction

The selected approach is incremental and provider-neutral:

1. Retain Firma as the production provider.
2. Complete the missing post-send operational controls and evidence handling.
3. Generalize persistence, webhook ingestion, and provider resolution without changing client-visible behavior.
4. Add Documenso Community Edition as a separate, staging-only service.
5. Compare both providers using synthetic individual and couple agreements.
6. Require a separate owner decision before any production cutover.

This direction is preferred over an immediate self-hosted migration because the current Firma flow already renders and approves the exact PDF, creates document-based requests, reconciles authoritative provider state, stores completed documents in Cornerstone, and promotes signed leads. Self-hosting offers control and an exit path, but it also adds certificate, database, SMTP, storage, backup, monitoring, security, and upgrade responsibility.

## Existing Capabilities to Preserve

- Attorney review of the exact signing PDF.
- Approval bound to the active revision ID and PDF SHA-256.
- Individual and couple recipient ordering.
- Idempotent create/send recovery after partial failures.
- Raw-body Firma HMAC verification, secret rotation, and event-ID deduplication.
- Provider-state re-fetch before durable business changes.
- Lead-to-matter promotion after completion.
- Completed-document storage in R2 and creation of a matter document.
- Existing staff authorization for engagement routes.
- Existing signed-date synchronization and matter status behavior.
- No changes to design sheets, estate draft payloads, document generation, or estate-plan drafting internals.

## Capability Enhancements

### Post-send controls

The engagement workspace gains a stable Status section after sending. Staff can:

- Refresh authoritative provider status.
- Resend a signing notification only to a currently eligible unsigned recipient.
- Cancel an active request with an explicit confirmation.
- Download the signed agreement, audit certificate, or combined evidence package when available.
- See sent, viewed, signed, declined, cancelled, expired, and completion timestamps per recipient.
- See the last provider synchronization time and the most recent actionable error.

Resend and cancel actions are server-authorized and idempotent. Browser callbacks never mark an agreement signed or completed.

### Evidence model

The current single `finalDocumentUrl` assumption is replaced by an artifact list:

```ts
export type EsignArtifactKind = 'signed_pdf' | 'audit_certificate' | 'combined_evidence'

export type EsignArtifact = {
  kind: EsignArtifactKind
  url: string
  mimeType: 'application/pdf' | 'application/zip'
}
```

Providers may return a combined PDF, separate PDFs, or both. Cornerstone stores each durable artifact under a deterministic R2 key and records its SHA-256, byte size, provider, external request ID, and retrieval time. The signed agreement and audit certificate remain distinguishable in the matter document workspace.

### Provider contract

The provider contract becomes the only integration surface used by the engagement service:

```ts
export interface EsignProvider {
  readonly name: EsignProviderName
  readonly capabilities: {
    resend: boolean
    cancel: boolean
    embeddedSigning: boolean
    separateAuditCertificate: boolean
  }
  createDocumentRequest(input: EsignDocumentRequestInput): Promise<EsignDocumentRequestResult>
  sendDocumentRequest(requestId: string, customMessage: string): Promise<void>
  getDocumentRequestState(requestId: string): Promise<EsignDocumentRequestState>
  resendDocumentRequest(input: {
    requestId: string
    recipientIds: string[]
    customMessage?: string
  }): Promise<void>
  cancelDocumentRequest(requestId: string, reason: string): Promise<void>
}
```

`EsignDocumentRequestState` contains normalized overall status, normalized recipient states, artifacts, and provider timestamps. Unsupported operations are disabled from capability metadata rather than failing after a user clicks.

Each signature/date field retains its searchable marker and may also carry a validated percentage placement (`page`, `x`, `y`, `width`, `height`). Firma uses markers in the current production path. The Documenso pilot requires explicit placements and fails closed if a required field has none. Placements are versioned with the engagement master and visually accepted for individual and couple variants; providers do not infer them from client data.

The legacy template-based `createEngagementEnvelope` contract is retained only until every active legacy envelope is reconciled. New engagement sends use `createDocumentRequest` exclusively.

### Provider-neutral persistence

The migration is additive and replay-safe:

- `engagement_agreements.provider` defaults to `firma`.
- `engagement_agreements.external_request_id` is backfilled from `firma_request_id`.
- `engagement_agreement_recipients.external_recipient_id` is backfilled from `firma_recipient_id`.
- `esign_webhook_events` stores `(provider, event_id)` as its unique idempotency key.
- `engagement_esign_artifacts` stores durable evidence metadata.
- A provider-neutral claim RPC replaces the Firma-specific claim for new deliveries.

The old Firma columns and table remain during the compatibility window. Code dual-writes generic and Firma compatibility columns while Firma is the provider. A later cleanup requires a production data audit and is not part of this plan.

### Webhook boundary

Each provider supplies a focused webhook adapter:

```ts
export interface EsignWebhookAdapter {
  readonly provider: EsignProviderName
  verify(rawBody: string, headers: Headers): boolean
  parse(rawBody: string, headers: Headers): EsignWebhookHint
}
```

`EsignWebhookHint` contains only the provider, external event ID, external request ID, and event type. The shared processor atomically claims the event, looks up the agreement by `(provider, external_request_id)`, fetches authoritative provider state, stores artifacts, applies recipient/agreement state, and records completion.

Firma keeps timestamped raw-body HMAC verification and secret rotation. Documenso's current shared-secret header is checked using constant-time comparison, but its payload is never trusted as authoritative state.

### Reliability and reconciliation

A protected reconciliation endpoint processes incomplete agreements in bounded batches. A Vercel Cron invocation may call it, but the endpoint itself owns authorization and the batch limit.

Reconciliation covers `sending`, `sent`, `viewed`, and `partially_signed` agreements whose last provider sync is older than fifteen minutes. It does not automatically resend notifications or cancel requests. It updates state only after an authoritative provider response.

Operational data includes:

- `last_provider_sync_at`
- `provider_sync_error`
- `provider_sync_error_at`
- `last_reminded_at` per recipient
- structured activity entries for refresh, resend, cancellation, completion, and evidence storage

## Documenso Pilot

Documenso is deployed as a separate staging service. It does not share Cornerstone's application database schema. The minimum production-shaped pilot uses:

- A dedicated PostgreSQL database.
- A dedicated signing certificate.
- SMTP or Resend for test-recipient delivery.
- S3-compatible object storage after a compatibility test.
- HTTPS termination and restricted outbound network access.
- Automated backups and a documented restore exercise.

Cornerstone selects the provider with `ESIGN_PROVIDER=firma|documenso`. Production rejects `documenso` unless `DOCUMENSO_PRODUCTION_ENABLED=true`; that flag is absent during the pilot.

The pilot uses only synthetic agreements and authorized test recipients. It runs at least:

- Ten individual agreements.
- Ten couple agreements with preserved order.
- One decline.
- One cancellation.
- One expiration.
- Duplicate webhook delivery.
- Webhook outage followed by reconciliation.
- Backup and restore of the Documenso service.

## Provider Decision Gate

No production migration occurs within this plan. A written comparison is required after the pilot. Firma remains the default unless Documenso passes all mandatory criteria:

- Exact US Letter PDF bytes and page geometry are preserved before fields are applied.
- Individual and couple field placement pass visual review.
- Recipient ordering and direct signing links are stable.
- Signed PDF and audit evidence can be retrieved and retained independently.
- Duplicate and delayed webhooks do not duplicate business effects.
- Email delivery is acceptable for the firm's real sending domain.
- Backup restoration succeeds within the documented recovery objective.
- Security and AGPL review are accepted.
- Monthly infrastructure and operating time are documented.

## Error Handling

- Provider actions require attorney or admin authorization and an agreement in an allowed state.
- Resend requires at least one persisted external recipient ID and rejects signed or declined recipients.
- Cancellation requires the agreement ID as explicit confirmation and never marks a completed agreement cancelled.
- Evidence downloads are fetched server-side; provider URLs are not persisted as permanent records.
- Artifact writes are idempotent by `(agreement_id, kind, sha256)`.
- Provider 429 and 5xx responses remain retryable and do not erase prior state.
- Unknown provider statuses normalize to `unknown` and create an operational error instead of advancing the agreement.
- Unknown external requests are acknowledged only after their provider event ID is durably recorded as foreign.
- A provider outage cannot change a lead or matter to hired or signed.

## Testing

Automated verification includes:

- Provider contract tests shared by Firma and Documenso.
- Firma request, resend, cancel, status, artifact, and webhook tests.
- Provider-neutral migration and RPC privilege tests.
- Webhook adapter signature and parsing tests.
- Shared processor idempotency and authoritative re-fetch tests.
- Status-action route authorization and state-transition tests.
- Workspace interaction and accessibility tests.
- Reconciliation batch, stale-record selection, and retry tests.
- Evidence hash, deterministic R2 key, and duplicate-storage tests.
- Regression tests for lead conversion, matter document creation, signed-date synchronization, and exact-revision approval.

Live verification is required for both individual and couple Firma flows before the operational controls are described as production-ready. The Documenso pilot is not verified by unit tests alone.

## Delivery Sequence

1. Lock the normalized provider contract and acceptance fixtures.
2. Add generic persistence and backfill without removing Firma columns.
3. Refactor Firma and webhook processing behind provider-neutral boundaries.
4. Add durable evidence artifacts and reconciliation.
5. Add authorized status actions and workspace controls.
6. Complete controlled Firma live verification.
7. Deploy and exercise the Documenso staging pilot.
8. Produce the provider decision report.

## Success Criteria

- Staff can see an accurate signing lifecycle and take safe post-send actions from Cornerstone.
- Every business state change is based on authoritative provider state.
- Signed agreements and audit evidence are permanently retained with hashes and provenance.
- Firma-specific database names no longer block an alternate provider.
- Existing active Firma requests continue to reconcile throughout the migration.
- A Documenso staging implementation is evaluated without client data or production routing.
- No provider cutover occurs without a separate owner decision.
- No estate-drafting internals are modified.
