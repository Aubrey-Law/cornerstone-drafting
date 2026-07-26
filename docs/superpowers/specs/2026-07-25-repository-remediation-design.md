# Repository Remediation Design

## Objective

Resolve the concrete security, migration, legal-document, React, and toolchain defects identified in the July 25 repository-wide review. Preserve Cornerstone's existing authorization and drafting architecture, add regression coverage before each behavioral change, and apply the completed database remediation to the hosted Supabase project only after repository tests pass.

## Scope and Delivery Order

The work is divided into four independently verifiable phases:

1. Supabase authorization and migration repair.
2. Firma webhook authentication.
3. Estate-document template correctness.
4. React and toolchain health.

The phases are implemented in that order. The database phase is deployed and verified independently before later application-only phases. No phase may weaken an existing server-side authorization boundary or bypass attorney review of generated legal documents.

## Supabase Authorization and Migration Repair

### Migration strategy

Create a uniquely versioned remediation migration with the Supabase CLI. Remove the duplicate-version lead-snooze migration from its colliding filename and include its schema and RPC changes in the new migration. The existing fee-status migration remains at `20260811000000`, matching hosted migration history.

The new migration must be safe to apply to both databases that received neither colliding migration and the hosted database that already received the fee-status migration. It may add the nullable snooze column, create or replace functions, replace one RLS policy, and modify grants. It must not delete or rewrite production rows.

### Function authorization

`delete_intake_contact` remains a service-role-only operation. The migration revokes execution from `PUBLIC`, `anon`, and `authenticated`, grants it only to `service_role`, and changes the function so it first deletes the contact with both identifiers in the predicate. Contact-role cleanup occurs only for a contact that was actually deleted.

`drafting_hub_draft_rollups` remains a service-role-only operation. The migration revokes execution from `PUBLIC`, `anon`, and `authenticated` and grants it only to `service_role`.

`mark_messages_read` continues supporting the authenticated client portal. Service-role callers may mark either side of a matter read. Non-service callers must:

- have a non-null `auth.uid()`;
- request the `client` reader role only; and
- own the matter through the same client ID or client-email relationship used by the portal document policy.

The function rejects unauthorized calls before updating messages or unread counters. Execution is revoked from `PUBLIC` and `anon`, then granted to `authenticated` and `service_role`.

### Meeting-note RLS

Replace `client_read_visible_matter_documents` so both the denormalized `folder` value and linked folder name exclude:

- `draft`
- `drafts`
- `meeting-notes`
- `meeting_notes`
- `meeting notes`

Staff access remains governed by the existing administrative policy. The change hides internal document metadata without changing R2 objects or application-owned records.

### Lead snoozing

Install `client_intake.lead_next_action_snoozed_until` and `snooze_lead_next_action` under the new unique migration version. The RPC remains service-role-only and retains its attorney/admin actor check, future-time validation, terminal-lead guard, and activity record.

### Hosted deployment and rollback

Repository migration tests, authorization contract tests, and focused lead-route tests must pass before deployment. Apply the exact reviewed migration text to hosted Supabase once. Then query the hosted catalog to verify:

- anonymous and authenticated execution are absent for service-only RPCs;
- `mark_messages_read` has only authenticated and service-role execution;
- the client document policy excludes meeting notes;
- the snooze column and RPC exist;
- migration history contains the new unique version; and
- security advisors no longer report the remediated anonymous definer functions.

If verification fails, stop before later phases. Grant and policy changes can be rolled back with a narrowly scoped follow-up migration; no production data rollback is expected because the migration performs no destructive data changes.

## Firma Webhook Authentication

Replace the query-string secret with Firma's documented raw-body signature protocol. A focused verification helper accepts the raw request bytes, the `X-Firma-Signature` header, current secret, optional previous secret, and current time. It:

- parses Firma's timestamp and versioned signature values;
- rejects malformed or missing headers;
- rejects timestamps outside the documented tolerance;
- computes the documented HMAC-SHA256 payload using constant-time comparison; and
- accepts either the current or previous secret during rotation.

The route reads the raw body once, verifies it before JSON parsing or database access, and no longer documents or accepts `?secret=`. Existing provider-state reconciliation remains authoritative.

The existing `firma_webhook_events.event_id` uniqueness constraint remains the durable idempotency boundary. The handler requires a stable event ID for state-changing events and claims it atomically before applying state. Duplicate deliveries return success without repeating side effects. Failed processing records enough state to support a safe provider retry rather than permanently treating a partial failure as complete.

Tests cover valid signatures, tampering, stale timestamps, malformed headers, current/previous secret rotation, duplicate events, and absence of the legacy URL-secret path.

## Estate-Document Correctness

The design sheet and draft-payload mappings remain authoritative. Changes are confined to the existing generator templates and narrowly necessary generator context.

### Durable power of attorney

The DPOA template must render:

- primary and co-agent names;
- the selected co-agent decision standard;
- primary and alternate self-dealing reviewers; and
- Section L only when selected.

Each supported co-agent arrangement must leave valid OOXML and must not emit contradictory default language.

### Health care proxy and HIPAA authorization

The HCP template must render the selected anatomical-gift mode and specified restriction text. The HIPAA template must conditionally include or exclude psychotherapy-note authorization according to the mapped design-sheet choice. Generated documents must not retain language contrary to the selected option.

### Estate-plan summary

The summary renders only sections relevant to the included document package and available household data. Spouse, DPOA-agent, and healthcare-agent fields become conditional. Guardian-only and young-adult packages must generate without unresolved markers while summaries for full plans retain their current substantive content.

The existing failing end-to-end generator tests are the primary acceptance tests. Additional focused assertions are added before template changes when an identified option lacks a precise regression check.

## React and Toolchain Health

Move design-sheet scroll and ordering synchronization out of render:

- section-change scroll resets occur in layout effects;
- the fast-entry section order is derived without mutating a ref inside `useMemo`; and
- softphone render output uses reactive state or render-safe derived values rather than reading mutable refs.

The changes must preserve current scroll restoration, fast-entry ordering, provider behavior, and active-call display.

Declare an upper Node major bound matching the build stack actually verified by the repository and add the same version expectation to the repository's standard runtime declaration if one exists. Repair stale test fixtures that prevent typecheck without weakening production types or excluding tests from typechecking.

Focused tests and ESLint run after each React fix. Final verification includes the full test suite, full lint, typecheck, `npm run build:next` on a declared-supported Node version, `git diff --check`, and a clean worktree check. Any unrelated pre-existing failure must be identified with exact evidence rather than silently ignored.

## Testing Method

All behavioral fixes follow red-green-refactor:

1. Add or tighten one regression test.
2. Run it and confirm it fails for the identified defect.
3. Implement the smallest production change.
4. Run the focused test and adjacent suite.
5. Refactor only while tests stay green.

DOCX files are binary production templates, so the existing XML-extraction generator tests provide the observable red/green boundary. Migration tests inspect exact grants, authorization predicates, policy exclusions, and unique versions; hosted catalog queries provide the post-deployment boundary.

## Completion Criteria

The remediation is complete when:

- every reviewed database exposure is closed in repository migrations and hosted ACL/policy verification;
- lead snoozing works in the hosted schema under a unique migration version;
- Firma webhooks use timestamped HMAC verification, rotation, replay protection, and durable idempotency;
- generated DPOA, HCP, HIPAA, guardian-only, and young-adult packets honor their selected data without unresolved markers;
- the identified render-time ref mutations are removed;
- the supported Node range matches a successful production build; and
- repository tests, lint, typecheck, build, and diff checks pass, except for any newly evidenced unrelated baseline failure reported explicitly.
