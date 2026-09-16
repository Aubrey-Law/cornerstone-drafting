# Scheduler Lawmatics and Statular Integration Design

**Date:** 2026-09-15
**Status:** Approved design, awaiting written-spec review

## Objective

Extend Cornerstone's native scheduler with independent Lawmatics and Statular
connectors while keeping Cornerstone and Google Calendar authoritative for booking
availability and appointment state.

The design intentionally avoids making Statular depend on Lawmatics. Lawmatics can
later be disabled or removed without migrating Cornerstone records, changing the
Statular connector, or interrupting booking.

The approved lifecycle is:

1. A confirmed Cornerstone booking creates or reuses a Statular client.
2. A lead becoming hired creates the Statular matter.
3. An administrator maps each Cornerstone plan/document-package key to the Statular
   `doc_id` required for matter creation.

## Selected Direction

Use independent provider adapters behind durable Cornerstone jobs:

- Cornerstone owns appointments, lead/matter identity, and workflow state.
- Google Calendar remains the scheduling and availability provider.
- Lawmatics receives a one-way CRM and appointment-event mirror.
- Statular receives create-only client and matter records directly from Cornerstone.
- Each connector has its own enablement flag, credentials, mappings, delivery state,
  retry rules, and administrative status.

This is preferred over a single generic CRUD adapter because Lawmatics and Statular
have materially different contracts. Lawmatics exposes a REST API, while the supplied
Statular integration consists of two secret, create-only webhook URLs and cannot
read, update, delete, or search records.

It is also preferred over Lawmatics-to-Statular fan-out because that would make the
Statular path dependent on a provider the firm may eventually discontinue. If the
firm enables Statular's native Lawmatics handoff separately, the Cornerstone direct
Statular connector must be disabled to prevent duplicate records.

## Scope

### Included

- Correct the existing Lawmatics authentication assumptions.
- Add a tested Lawmatics API client with normalized errors and rate-limit handling.
- Mirror booked, rescheduled, and cancelled Cornerstone appointments to Lawmatics.
- Create a Statular client after a confirmed booking.
- Create a Statular matter after the related Cornerstone matter becomes hired.
- Add administrator configuration for Statular document-package IDs.
- Persist provider IDs, idempotency state, delivery status, and actionable errors.
- Add durable job execution and reconciliation for missed or interrupted deliveries.
- Show connector configuration and per-record synchronization state to staff.
- Collect first and last name separately for new bookings while retaining the combined
  attendee display name.
- Update stale Outlook wording in native scheduler settings and appointment email.

### Excluded

- Making Lawmatics or Statular authoritative for Cornerstone appointment state.
- Importing Lawmatics appointment changes into Cornerstone.
- Updating or deleting Statular clients or matters; the supplied API does not support
  those operations.
- Sending attendee invitations from Lawmatics. Google/Cornerstone remain responsible
  for invitations and notifications, avoiding duplicate client communications.
- Changing drafting payload generation, design-sheet behavior, document generation,
  or the existing Statular Markdown export.
- Automatically enabling the integration in production.
- Retiring Calendly, Lawmatics, or existing compatibility columns in this project.
- Broad scheduler improvements such as CAPTCHA, email-confirmed holds, secondary
  Google calendar selection, or attendance status. Those remain separate follow-ups.

## Existing Behavior to Preserve

- Public and portal booking routes and the database overlap constraint.
- Google free/busy checks and Google event creation.
- Client manage links for cancellation and rescheduling.
- Confirmation, reminder, no-show, and post-booking automation behavior.
- Existing lead and matter linkage and the current Lawmatics intake import.
- Calendly webhook ingestion and read-only mirrored appointments.
- Existing durable-workflow lease, claim-token, timeout, retry, and manual-retry
  safeguards.
- Staff-only access to integration settings and operational data.

## Architecture

### Domain events and jobs

Booking and lifecycle code emit provider-specific durable jobs after the local state
change succeeds:

```ts
type IntegrationJobType =
  | 'lawmatics_sync_appointment'
  | 'statular_create_client'
  | 'statular_create_matter'
```

`lawmatics_sync_appointment` derives the required operation from current appointment
state and its last synchronized version. This prevents separate create, update, and
cancel handlers from drifting.

The existing `workflow_jobs` table and worker gain these job types. Jobs contain
Cornerstone identifiers and a payload version, not webhook URLs, OAuth tokens, or
client manage tokens. Provider adapters load the source record server-side.

Enqueueing is idempotent. Dedupe keys include the provider, entity, operation version,
and provider-record kind. Reconciliation may therefore enqueue work safely without
creating duplicate external records.

### Provider boundaries

Provider modules expose purpose-specific contracts rather than a misleading common
CRUD interface:

```ts
interface LawmaticsAppointmentConnector {
  syncAppointment(appointmentId: string): Promise<IntegrationResult>
}

interface StatularConnector {
  createClient(source: StatularClientSource): Promise<IntegrationResult>
  createMatter(matterId: string): Promise<IntegrationResult>
}
```

Both return a normalized result containing provider, external record type, external
ID, operation, and provider metadata. Provider modules do not update Cornerstone
business state directly; the integration service records the result.

### Reconciliation

A bounded, authenticated reconciliation route finds eligible records that lack a
successful provider result or have retryable failed work. It re-enqueues missing jobs
rather than calling providers inline. A scheduled invocation may call this route,
but the route owns authorization, batch limits, and provider enablement checks.

Reconciliation covers:

- Scheduled, rescheduled, or cancelled Cornerstone appointments missing the expected
  Lawmatics Event state.
- Confirmed native appointments with a linked lead or matter and no Statular client.
- Hired matters with a mapped Statular package and no Statular matter.

Calendly-imported appointments do not create Statular clients or Lawmatics Events in
this project. That avoids replaying records that may already have been processed by
another system.

## Persistence

### Integration settings

Add a singleton `integration_settings` table with:

- `lawmatics_appointment_sync_enabled boolean not null default false`
- `lawmatics_event_type_id_map jsonb not null default '{}'`
- `lawmatics_location_id_map jsonb not null default '{}'`
- `lawmatics_user_ids jsonb not null default '[]'`
- `statular_sync_enabled boolean not null default false`
- `statular_doc_id_map jsonb not null default '{}'`
- nullable `statular_drafter_id`
- audit timestamps and `updated_by`

The Lawmatics maps use stable Cornerstone appointment-type and meeting-format keys.
The server validates non-empty provider IDs and requires an event-type mapping before
an appointment type can be synchronized. A missing required Lawmatics mapping becomes
an actionable configuration error; it does not send a partially guessed event.

`statular_doc_id_map` maps a stable Cornerstone plan/document-package key to a positive
Statular `doc_id`. The server validates every key and value before saving. Package IDs
are ordinary configuration, not secrets.

Statular webhook URLs remain server-only environment variables:

- `STATULAR_CLIENT_WEBHOOK_URL`
- `STATULAR_MATTER_WEBHOOK_URL`
- `STATULAR_WEBHOOK_GENERATION`

The UI reports only whether each URL is configured. It never returns, logs, or embeds
a webhook URL in browser code. Lawmatics client credentials remain server-only, and
the OAuth access token remains in the protected token table.

`STATULAR_WEBHOOK_GENERATION` is a short, non-secret deployment value such as `v1`.
It must change when either webhook is rotated. The generation participates in the
idempotency key and stored delivery metadata; a missing generation prevents Statular
enablement.

### External records

Add `integration_external_records`:

- `provider`: `lawmatics` or `statular`
- `internal_entity_type`: `lead`, `matter`, or `appointment`
- `internal_entity_id`
- `external_record_type`: `prospect`, `event`, `client`, or `matter`
- nullable `external_id`
- `status`: `pending`, `synced`, `attention`, or `disabled`
- `source_version`
- `idempotency_key`
- protected `request_snapshot`
- `request_hash`
- last attempt, success, error code, safe error message, and timestamps
- provider metadata that contains no credentials

The unique key is `(provider, internal_entity_type, internal_entity_id,
external_record_type)`. External IDs are unique within provider and record type when
present.

The table is provider-neutral so no Lawmatics ID becomes a Cornerstone identity. It
is service-role only with RLS enabled and no direct browser policy. Authorized admin
routes return a safe projection that excludes request snapshots and provider metadata.
Existing Lawmatics compatibility columns remain during this project; the connector
may read them to reuse imported records but new synchronization state is written to
the neutral table.

Add nullable `attendee_first_name`, `attendee_last_name`,
`second_attendee_first_name`, and `second_attendee_last_name` columns to appointments.
New writes require the primary components. Historical rows remain valid and retain
their combined names.

### Lawmatics tokens

Make the existing `expires_at` column nullable and stop requiring or using a refresh
token. Preserve the old columns for compatibility, but do not fabricate an expiry.
The status endpoint reports connected/disconnected state and last successful API
check without exposing token prefixes.

## Booking and Identity Flow

### Name capture

Statular requires `first_name` and `last_name`. New public, portal, and staff-created
bookings collect those values separately. The server constructs `attendee_name` for
calendar display and continues reading historical rows that contain only the combined
name.

The integration does not silently guess a last name from a one-word or ambiguous
historical display name. A historical record without valid component names is marked
`attention` for staff correction.

### Confirmed booking

After a native appointment is committed and linked:

1. Normal booking response, Google calendar creation, and client email continue.
2. If Lawmatics appointment sync is enabled, enqueue
   `lawmatics_sync_appointment`.
3. If Statular sync is enabled, enqueue `statular_create_client`.
4. Provider failures cannot roll back or falsely fail the confirmed booking.

The Statular client source is the stable `client_intake` identity reached through the
linked lead or matter, not attendee email alone. If the same person books again, the
unique external-record row and stable idempotency key reuse the prior Statular client
instead of creating another.

For a spouse or partner, the approved initial behavior is one Statular client payload
using Statular's partner fields. It does not create a second independent Statular
client unless a future provider requirement calls for it.

### Lawmatics appointment mirror

The connector first resolves or creates the Lawmatics Prospect:

- Reuse an existing neutral Prospect mapping.
- Reuse a verified existing Lawmatics import mapping when it refers to the same
  Cornerstone lead.
- Otherwise create a Prospect and record the returned ID.

It then creates or updates one Lawmatics Event for the Cornerstone appointment and
stores the Event ID. The event includes the appointment type, start/end, timezone,
location, linked Prospect, assigned user/location mappings when configured, and a
non-secret Cornerstone appointment reference.

Lawmatics attendee invitations and reminders are disabled. Cornerstone/Google remain
the only systems sending scheduler communications. Cancellation removes or cancels
the Lawmatics Event without sending another attendee notification.

This is one-way synchronization. The published Lawmatics outbound-webhook event list
does not provide a reliable appointment-created/rescheduled/cancelled contract, so
Lawmatics appointment changes are not accepted as authoritative input.

### Statular client creation

The client adapter sends only documented Statular fields. Its idempotency key is
stable for the Cornerstone `client_intake` identity and webhook generation, for
example: `cornerstone:statular:client:<client-intake-id>:v1`.

The first outbound request snapshot and hash are persisted. Retries reuse exactly the
same payload and key; they do not produce a Statular `409` by changing a payload under
an existing key. A successful `201` records the returned client ID before the job is
completed.

Because Statular is create-only, later corrections remain visible as an operational
warning rather than pretending Statular was updated. Staff may correct the Statular
record directly. A separately approved future API integration may add updates if
Statular exposes them.

## Hiring and Statular Matter Flow

When `matters.relationship_status` transitions to `hired`, enqueue
`statular_create_matter` if Statular is enabled. The job:

1. Finds the Statular client ID associated with the matter's source lead.
2. Creates the client first if a prior booking did not do so or its delivery remains
   incomplete.
3. Resolves a stable `<practice-area>:<plan-key>` package key from the
   attorney-selected legal plan or normalized design plan without changing drafting
   data. Estate-planning design values are read through the existing normalization
   helpers; other practice areas synchronize only when an explicit mapping exists.
4. Looks up the package key in `statular_doc_id_map`.
5. Sends the matter payload with `client_id`, `doc_id`, Massachusetts state code,
   matter name, and an optional configured drafter ID.
6. Records the returned Statular matter ID.

If the client is not yet available, the matter job remains retryable behind the client
dependency. If the package is not yet selected or mapped, the job becomes `attention`
with `configuration_required`; hiring itself still succeeds. Saving a valid mapping
or selecting the legal plan re-enqueues eligible attention records.

The Statular matter idempotency key is stable for the Cornerstone matter and webhook
generation, for example `cornerstone:statular:matter:<matter-id>:v1`.

## Error Classification and Retry

Provider clients return typed outcomes:

- `retryable`: timeouts, connection failures, Lawmatics `429`, Statular `429`, and
  provider `5xx` responses.
- `attention`: authentication/revocation, permission problems, mapping/configuration
  gaps, validation failures, and idempotency payload conflicts.
- `success`: created, updated, cancelled, or an idempotent replay returning the
  existing external ID.

Lawmatics `429` retries honor `Retry-After`. Statular retries respect the documented
30-per-minute and 500-per-day per-webhook limits. Authentication, permission, and
validation errors do not consume all automatic attempts. Safe error text is stored;
response bodies and request payloads containing client data are not written to
application logs.

A `409` from Statular during a concurrent identical request is retried after a short
delay. A `409` caused by reusing a key with a different request hash becomes
`attention` and is not blindly retried.

## Administration and Operations

The Scheduling settings area gains an Integrations section:

- Lawmatics connection state, last API check, appointment-sync toggle, and local
  disconnect action.
- Statular client-webhook configured state, matter-webhook configured state,
  synchronization toggle, and document-package mapping editor.
- A warning that Cornerstone direct Statular sync and Statular's Lawmatics handoff
  must not both be enabled.
- A bounded list of pending and failed integration jobs with provider, entity link,
  safe error, attempt count, last attempt, and staff retry action.

Appointment details show independent Google and Lawmatics status. Lead/matter details
show Statular client/matter state. A failure in one provider never displays another
provider as failed.

The stale Outlook descriptions in scheduler settings, database comments touched by
the migration, and appointment confirmation text are changed to Google-accurate or
provider-neutral language.

## Security and Privacy

- All connector calls are server-side.
- Statular webhook URLs are treated as credentials and never persisted in ordinary
  settings, sent to the client, or included in errors.
- Integration routes require attorney/admin authorization.
- Service-role writes are constrained through narrow integration services and RPCs.
- Idempotency keys contain opaque Cornerstone IDs, not names or email addresses.
- Application logs contain provider, operation, internal ID, status code, and safe
  error classification, but no tokens, secret URLs, full provider bodies, or client
  payloads.
- Operational UI never exposes OAuth tokens or webhook URL prefixes.
- Disabling a connector stops new provider calls but retains mappings and audit state
  for a safe future re-enable or migration.

## Testing

### Unit and contract tests

- Lawmatics authentication no longer fabricates expiry or refreshes tokens.
- Lawmatics JSON:API request, error normalization, `Retry-After`, Prospect reuse, and
  Event create/update/cancel behavior.
- Statular client and matter payload validation, exact allowed fields, success parsing,
  idempotency headers, request hashes, and status classification.
- Separate-name booking validation and historical-name attention behavior.
- Package-to-`doc_id` validation and missing-mapping behavior.
- Provider disablement and independent failure behavior.

### Job and persistence tests

- Additive migration constraints, RLS, uniqueness, and generated types.
- Stable dedupe keys and exactly-once external-record claims.
- Lease expiry, concurrent workers, retry delay, claim-token protection, and manual
  retry using the existing workflow-job behavior.
- Booking enqueues Lawmatics and Statular independently.
- Repeat booking reuses an existing Statular client.
- Hiring waits for the client dependency and creates one Statular matter.
- Missing `doc_id` mapping becomes attention and re-enqueues after configuration.
- Reconciliation repairs missing jobs without duplicating external records.
- Calendly-imported appointments remain excluded.

### Route and UI tests

- Staff authorization for settings, status, retry, and disconnect routes.
- No secret URL or token material reaches serialized browser props or route responses.
- Integration settings validation and package mapping interactions.
- Lawmatics event-type, user, and location mapping validation.
- Independent provider badges and actionable failure messages.
- Booking, rescheduling, cancellation, Google sync, emails, reminders, and existing
  Lawmatics import regression coverage.

### Live acceptance gates

Before production enablement, use authorized test records to verify:

- One individual and one couple booking create the intended Statular client shape.
- A repeat booking does not create another Statular client.
- Hiring with each configured package creates the correct Statular matter.
- A booking, reschedule, and cancellation produce the intended Lawmatics Event state
  without duplicate attendee messages.
- Invalid/revoked Statular URLs and Lawmatics rate limiting surface actionable state
  and recover after correction.
- Disabling Lawmatics leaves Statular creation and all scheduler behavior intact.

Passing automated tests alone does not establish live provider compatibility.

## Delivery Sequence

Deliver as independently reviewable changes:

1. **Foundation:** additive persistence, job types, normalized integration status,
   and generated types.
2. **Lawmatics authentication:** align OAuth storage/status with current provider
   behavior and add the request/error client.
3. **Lawmatics appointment mirror:** Prospect resolution, Event synchronization,
   reconciliation, and tests.
4. **Statular client:** separate booking names, direct client webhook, stable
   idempotency, repeat-booking reuse, and tests.
5. **Statular matter:** package mapping, hired transition, dependency handling,
   direct matter webhook, and tests.
6. **Operations:** settings/status UI, retry controls, per-record state, and stale
   Outlook copy cleanup.
7. **Provider acceptance:** live synthetic verification followed by explicit production
   enablement.

Database changes are additive. No provider-specific compatibility column or historical
mapping is removed in this sequence.

## Deferred Scheduler Improvements

The audit identified useful follow-up work that is not required to deliver these
connectors safely:

1. Include selected secondary/shared Google calendars in availability blocking.
2. Reconcile Google changes on a schedule rather than only when staff load the calendar.
3. Pass explicit lead/matter IDs through staff and portal booking instead of relying
   primarily on email matching.
4. Add public-booking abuse controls and, if desired, email-confirmed tentative holds.
5. Add attended/completed status and a configurable cancellation cutoff.
6. Clarify or retire overlapping native and Calendly booking authorities.

Each should remain separately releasable so integration work does not hide booking
policy changes.

## Success Criteria

- A confirmed native booking creates exactly one Statular client when enabled.
- Hiring creates exactly one Statular matter after a valid package mapping is available.
- Lawmatics accurately mirrors native appointment creation, rescheduling, and
  cancellation without sending duplicate attendee notifications.
- Lawmatics and Statular failures, retries, disablement, and operational state remain
  independent.
- A provider outage never rolls back or falsely fails a valid Cornerstone booking or
  hiring transition.
- Removing Lawmatics later requires no Cornerstone or Statular identity migration.
- Credentials never reach browser code or ordinary logs.
- Existing scheduler, Lawmatics import, Calendly mirror, and drafting behavior continue
  to pass regression tests.
