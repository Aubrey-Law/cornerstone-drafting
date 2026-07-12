# Firma Engagement Agreements Design

## Objective

Add a matter-linked engagement-agreement workflow to Cornerstone Lite that generates editable, practice-specific DOCX agreements from structured inputs, sends the finalized document through Firma, and tracks signing status without changing estate-plan drafting internals.

The workflow must eliminate the current need to maintain separate fixed-page Firma PDF templates for every practice-area and client-count combination.

## Scope

The first release supports the three canonical Cornerstone practice areas:

- `EP`
- `EP-LP`
- `Probate`

Each practice area supports an individual or couple. Only clients sign: one signer for an individual and two signers for a couple. No attorney signature is required.

`EP-LP` also supports three displayed legal-plan choices:

- MetLife
- LegalEase
- ARAG

MetLife and LegalEase share substantive agreement language while displaying the selected plan name. ARAG substitutes a small number of identified clauses.

The first release supports structured changes, not unrestricted word-processing in the browser. Structured fields include agreement date, client identity and contact information, scope/package, fee and payment terms, legal plan, approved optional clauses, internal agreement name, email message, and expiration.

## Approaches Considered

### Three conditional DOCX masters (selected)

Maintain one editable source agreement for each practice area. Each master contains individual/couple branches. The `EP-LP` master also contains shared MetLife/LegalEase language and ARAG substitutions.

This keeps practice-area review boundaries clear while eliminating duplicated individual/couple documents.

### One universal DOCX master

A single agreement could branch on practice area, client count, and legal plan. It would minimize file count but mix unrelated legal provisions and make review and maintenance riskier.

### Six or more independent documents

Maintaining a separate agreement for every combination is straightforward per file but duplicates revisions and allows variants to drift. It also preserves the current maintenance problem.

## Architecture

Cornerstone owns the editable DOCX masters, structured agreement data, revision history, validation, and authorization. Firma is the delivery and electronic-signature provider.

The feature is isolated from the design sheet, draft payload, estate generator, and review workspace. It may read matter, client, spouse, practice-area, and legal-plan facts, but it must not rewrite drafting internals.

The system has these focused units:

1. **Agreement definition layer** — declares allowed inputs, defaults, clauses, and conditions for each practice area.
2. **Agreement renderer** — combines a versioned DOCX master and validated inputs, converts it through Cornerstone's existing LibreOffice worker, and returns both editable DOCX and immutable signing PDF artifacts.
3. **Agreement service** — enforces matter access, validation, revision locking, preview generation, and send confirmation.
4. **Firma client** — creates document-based signing requests, sends, retrieves, cancels, resends, and downloads results.
5. **Webhook handler** — verifies Firma signatures, deduplicates events, and updates recipient and agreement status.
6. **Matter UI** — prepares, previews, revises, sends, and monitors agreements.
7. **Cornerstone MCP** — exposes a narrow conversational interface over the same agreement service after the standard UI workflow is proven.

Firma template replacement is not part of the workflow. Cornerstone converts each finalized DOCX through its existing `convertDocxToPdf` worker and submits the resulting US Letter PDF as a new document-based signing request. The attorney previews the exact PDF the client will sign.

The DOCX masters contain white/invisible searchable anchors that survive Cornerstone's PDF conversion. Firma uses those PDF anchors after pagination is final. The single-signer PDF lifecycle is proven; final offsets/dimensions and two-signer behavior still require visual acceptance before release.

## Matter Workflow

From a matter, an attorney selects **Prepare engagement agreement**. Cornerstone prepopulates:

- Practice area from `matter_details.practice_area`
- Individual/couple from client and spouse data
- Client names and email addresses
- Available matter and legal-plan defaults

For `EP-LP`, the plan choice is required. Selecting MetLife or LegalEase uses the shared provision set and inserts the selected plan name. Selecting ARAG activates the approved ARAG clause substitutions.

The attorney reviews structured fields, generates an editable DOCX plus signing-PDF preview, and may revise those fields. Each change creates a new unsent revision and regenerates both artifacts. Sending requires explicit confirmation bound to the current PDF checksum.

Once sent, a revision is immutable. A correction is prepared as a new revision and signing request; Cornerstone never silently mutates an active signature packet.

## Persistence

An `engagement_agreements` record is linked to a matter and stores:

- Practice area, individual/couple configuration, and legal plan
- Structured input snapshot
- Master-template identifier and version
- Rendered revision identifier or checksum
- Firma signing-request ID
- Preparing and sending staff IDs
- Agreement status and timestamps
- Completed-document and audit-trail references

Recipient records track each signer independently, including Firma recipient ID, email snapshot, order, and status timestamps.

Agreement statuses are:

- `draft`
- `ready`
- `sent`
- `viewed`
- `partially_signed`
- `completed`
- `cancelled`
- `expired`
- `failed`

The existing `matter_details.engagement_signed` field is a manual override, not the new workflow's source of truth. During migration, the matter UI may continue honoring an explicit override, but new Firma completion should derive the normal displayed state from the latest applicable agreement record. The implementation plan must specify precedence and a safe retirement path for the override.

## Firma Integration

The Firma API key remains server-only. Cornerstone must not send it to the browser or expose general Firma administration through MCP.

Creating an agreement performs a document-based Firma signing-request call with the rendered DOCX, recipients, and anchor definitions. Sending is a separate explicit operation unless the proof of concept demonstrates an equally safe atomic endpoint with idempotency guarantees.

The integration records the external request ID before reporting success. A deterministic idempotency guard or local send claim prevents duplicate requests from repeated clicks or retries.

Firma webhooks update created, sent, viewed, signed, completed, cancelled, and expired states. The endpoint must:

- Verify the raw-body HMAC signature
- Support documented secret rotation
- Store and deduplicate Firma event IDs
- Respond promptly and process durable state changes safely
- Reject events for unknown workspaces or requests

After completion, Cornerstone retrieves and retains or references the completed PDF and audit trail according to the application's document-retention pattern.

## MCP Design

MCP is an optional interface, not a second implementation. It calls the same agreement service as the matter UI.

The initial tool surface is deliberately narrow:

- `engagement_agreements_prepare`
- `engagement_agreements_get`
- `engagement_agreements_update_structured_fields`
- `engagement_agreements_preview`
- `engagement_agreements_approve_revision`
- `engagement_agreements_send`
- `engagement_agreements_status`
- `engagement_agreements_cancel`
- `engagement_agreements_resend`

Tools operate on stable matter and agreement IDs. Client-name search alone cannot authorize or identify a send. Arbitrary agreement text replacement and Firma workspace/template administration are out of scope.

Approval produces a short-lived confirmation bound to the exact rendered revision. The send tool rejects missing, stale, changed, or already-used confirmations. This makes a conversational send no less controlled than the UI workflow.

## Current-Build Audit and Decommissioning

The current `main` implementation already has a working Firma engagement flow. This project is therefore a refactor and extension of that integration, not a greenfield replacement.

The existing implementation includes:

- `app/admin/settings/EsignTemplateEditor.tsx`, which embeds Firma's template editor
- `POST /api/admin/esign/template-token`, which mints a short-lived editor JWT
- `lib/esign/firma.ts`, which selects single- or joint-signer Firma templates and creates signing requests
- Lead and matter engagement send routes
- One- and two-client sending and direct **Sign now** links
- A Firma webhook route that reconciles provider state
- Lead-to-matter conversion when a pre-matter engagement is signed
- Completed signed-PDF retrieval, R2 storage, and matter-document creation
- Engagement state columns on `client_intake` and `matter_details`

### Retain and adapt

Retain these business capabilities while moving them behind the new agreement service:

- Lead and matter send entry points
- Client/spouse collection and validation
- Direct signing links
- Lead-to-matter conversion after signature
- Provider state reconciliation
- Completed-document download and R2 storage
- Matter-document creation
- Existing authorization and useful status presentation

The existing generic e-sign provider boundary may remain if document-based creation and per-recipient lifecycle data fit it cleanly. It should be reshaped rather than preserved artificially if its envelope-only contract prevents revision and recipient tracking.

### Replace

Replace these assumptions:

- Template-based `createAndSendSigningRequest`
- One fixed Firma template for individuals and one for couples
- Immediate send without a rendered-document review revision
- One envelope ID stored directly on `matter_details` or `client_intake`, where re-send overwrites history
- The narrow `sent | signed | declined` state model
- Fixed-position template fields that require page-compatible source documents

The new service creates each request from a rendered DOCX, stores immutable revisions and recipients, and links the active/latest agreement back to the lead or matter without discarding prior requests.

### Remove after cutover

The target design does not need Firma's general template editor. After document-based sending is proven and deployed, remove:

- `EsignTemplateEditor`
- `/api/admin/esign/template-token`
- `generateEngagementTemplateToken`
- The embedded Firma editor script and admin-settings tab
- `FIRMA_ENGAGEMENT_TEMPLATE_ID`
- `FIRMA_ENGAGEMENT_TEMPLATE_ID_JOINT`
- Tests and environment documentation that exist only for those pieces

The three controlled DOCX masters become the legal source documents. Master updates follow a versioned upload/publish or repository-controlled process with rendering fixtures and legal review, not direct editing of a live Firma signing template.

### Migrate

Preserve active envelope identifiers and statuses long enough to finish or reconcile requests sent before cutover. Preserve already downloaded signed agreements and matter-document records. Define how existing lead and matter engagement columns map to the latest agreement record before retiring or demoting those columns.

No editor, environment variable, route, or schema is removed until the document-based workflow passes end-to-end verification and active legacy envelopes have a documented reconciliation path.

### Webhook security correction

The current webhook uses a shared secret in the callback URL and treats the payload as a hint before re-fetching Firma state. Current Firma documentation describes raw-body HMAC SHA-256 verification through `X-Firma-Signature`, an old-signature header during rotation, and event IDs for deduplication.

Retain authoritative provider re-fetching as defense in depth, but replace query-string authentication with the currently documented HMAC flow during this work. Store processed event IDs and support secret rotation. The Firma proof of concept must confirm the production workspace's actual webhook contract before cutover because the checked-in comments and current public documentation differ.

## Error Handling and Safety

- Missing signer names or emails block preview approval and send.
- `EP-LP` agreements require a valid legal-plan selection.
- Unknown structured fields and clauses are rejected.
- Rendering failures preserve the prior valid revision and do not call Firma.
- Firma creation failures leave a recoverable local draft/failed record.
- A request is not marked sent without a confirmed Firma response or reconciled external state.
- Sent revisions are immutable.
- Duplicate clicks, API retries, and duplicate webhooks are idempotent.
- Authorization is enforced in the service layer for UI and MCP callers.
- Activity records identify the staff member, action, revision, and external request.

## Verification

Automated coverage includes:

- All three practice areas
- Individual and couple rendering
- MetLife and LegalEase shared clauses with distinct displayed plan names
- ARAG substitutions
- Fee, payment, scope, and approved optional-clause variations
- Missing and invalid signer data
- One- and two-signer anchor generation
- Revision checksum and stale-confirmation rejection
- Duplicate-send prevention
- Webhook signature verification, secret rotation, and event deduplication
- Partial and complete couple signing
- Post-send immutability
- UI and MCP authorization
- Matter status/override precedence
- Regression checks demonstrating no estate-drafting internal changes

A live Firma proof of concept must verify DOCX conversion, anchor placement, client-only signing, completed-PDF retrieval, audit-trail retrieval, and webhook payload/signature behavior.

## Delivery Sequence

1. Capture current lead send, matter send, direct-signing, conversion, webhook, and document-storage behavior in focused regression tests.
2. Run a Firma sandbox proof of concept using generated DOCX files, anchors, completed-document retrieval, and the current webhook contract.
3. Convert and reconcile the six Word agreements into three conditional masters, with legal review of every branch.
4. Build deterministic rendering and fixture tests.
5. Add agreement persistence, revisions, recipients, authorization, and preview while preserving legacy-envelope reconciliation.
6. Refactor the existing Firma provider to create document-based requests and track the expanded lifecycle.
7. Upgrade webhook verification and adapt the existing lead conversion and signed-document storage behavior.
8. Replace the current lead and matter send forms with the structured preparation, preview, approval, and status workflow.
9. Migrate required historical state and remove the confirmed obsolete Firma template editor, token route, template IDs, and associated tests/configuration.
10. Add the narrow Cornerstone MCP tools over the proven service.

## Success Criteria

- A staff member can prepare either an individual or couple agreement for `EP`, `EP-LP`, or `Probate` from the matter page.
- `EP-LP` correctly renders MetLife, LegalEase, or ARAG language.
- Ordinary agreement revisions are made in three source masters rather than six signing templates.
- Structured matter-specific changes can be previewed before sending.
- Pagination changes do not require replacement documents to match an existing Firma template.
- A reviewed revision cannot change after sending.
- Cornerstone shows accurate per-recipient and overall signing status and retains the completed agreement and audit evidence.
- Codex can prepare and send through MCP with the same authorization, validation, confirmation, and audit controls as the UI.
- Obsolete template-editor functionality is removed only after live-use and data-migration checks pass.
