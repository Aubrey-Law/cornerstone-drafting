# Repository Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the reviewed database and webhook vulnerabilities, restore legal-document fidelity, and return the repository to a truthful supported build state.

**Architecture:** Deliver four independently verifiable phases: database authorization and schema repair, Firma webhook authentication, legal-template correction, and React/toolchain cleanup. Each behavioral change starts with a failing regression test; hosted Supabase receives only reviewed migrations whose repository tests pass, followed by direct catalog and advisor verification.

**Tech Stack:** Next.js App Router, React, TypeScript, Vitest, PostgreSQL/Supabase RLS and RPCs, Firma HMAC-SHA256 webhooks, DOCX/Nunjucks OOXML templates, ESLint.

## Global Constraints

- Preserve Cornerstone's existing drafting architecture and do not port drafting code from `aubrey-law-app`.
- Apply completed database migrations to hosted Supabase only after repository tests pass.
- Do not delete or rewrite production rows.
- Keep `delete_intake_contact` and `drafting_hub_draft_rollups` service-role-only.
- Keep authenticated portal support for `mark_messages_read`, with an in-function ownership check.
- Treat design-sheet selections as authoritative for generated legal documents.
- Use the exact raw request body for Firma signature verification.
- Do not accept the legacy Firma query-string secret after cutover.
- Verify the final build on a Node major explicitly declared as supported.

---

### Task 1: Add Database Security Regression Contracts

**Files:**
- Create: `tests/repository-security-remediation.test.ts`
- Modify: `tests/matter-owned-lead-lifecycle.test.ts:8-14`
- Read: `supabase/migrations/20260717000001_lite_delete_intake_contact_rpc.sql`
- Read: `supabase/migrations/20260717000000_drafting_hub_draft_rollups.sql`
- Read: `supabase/migrations/20260710500000_lite_portal_messages.sql`
- Read: `supabase/migrations/20260705000002_drafting_baseline_pipeline.sql`

**Interfaces:**
- Consumes: migration SQL files in `supabase/migrations`.
- Produces: a source-contract test that locates the remediation migration by its `_repository_security_remediation.sql` suffix and asserts its authorization and schema guarantees.

- [ ] **Step 1: Write the failing migration contract**

Create a test that reads all migration names, finds exactly one remediation migration, and asserts:

```ts
expect(sql).toContain(
  'revoke execute on function public.delete_intake_contact(uuid, uuid) from public, anon, authenticated',
)
expect(sql).toContain(
  'revoke execute on function public.drafting_hub_draft_rollups(text[]) from public, anon, authenticated',
)
expect(sql).toContain(
  'revoke execute on function public.mark_messages_read(text, text) from public, anon',
)
expect(sql).toContain(
  'grant execute on function public.mark_messages_read(text, text) to authenticated, service_role',
)
expect(sql).toContain("p_reader_role <> 'client'")
expect(sql).toContain('m.client_id = auth.uid()')
expect(sql).toContain("'meeting-notes'")
expect(sql).toContain("'meeting_notes'")
expect(sql).toContain('lead_next_action_snoozed_until timestamptz')
expect(sql).toContain('create or replace function public.snooze_lead_next_action')
```

Also assert that contact roles are deleted only after the ownership-qualified contact deletion succeeds:

```ts
expect(sql.indexOf('delete from public.contacts')).toBeLessThan(
  sql.indexOf('delete from public.contact_roles'),
)
expect(sql).toContain('if deleted_count > 0 then')
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npm test -- --run tests/repository-security-remediation.test.ts tests/matter-owned-lead-lifecycle.test.ts
```

Expected: FAIL because the remediation migration does not exist and the two `20260811000000` filenames still collide.

- [ ] **Step 3: Commit the red tests**

```bash
git add tests/repository-security-remediation.test.ts tests/matter-owned-lead-lifecycle.test.ts
git commit -m "test: cover repository security remediation"
```

### Task 2: Create the Security and Lead-Snooze Migration

**Files:**
- Create via CLI, then order after current migrations: `supabase/migrations/20260812000000_repository_security_remediation.sql`
- Delete: `supabase/migrations/20260811000000_lead_next_action_snooze.sql`
- Test: `tests/repository-security-remediation.test.ts`
- Test: `tests/matter-owned-lead-lifecycle.test.ts`
- Test: `tests/lead-details-persistence.test.ts`
- Test: `tests/lead-detail-route.test.ts`

**Interfaces:**
- Consumes: existing function definitions and the lead-snooze SQL from the colliding migration.
- Produces: one idempotent migration that can run after hosted version `20260811000000`.

- [ ] **Step 1: Generate the migration with the Supabase CLI**

Discover the installed syntax and generate the file:

```bash
./node_modules/.bin/supabase migration new repository_security_remediation
```

If the generated timestamp sorts before `20260811000000`, rename only that generated file to `20260812000000_repository_security_remediation.sql` so hosted migration order remains monotonic.

- [ ] **Step 2: Implement safe contact deletion and grants**

Replace `delete_intake_contact` with this control flow:

```sql
delete from public.contacts
where id = p_contact_id
  and client_intake_id = p_client_intake_id;

get diagnostics deleted_count = row_count;

if deleted_count > 0 then
  delete from public.contact_roles where contact_id = p_contact_id;
end if;
```

Then set grants explicitly:

```sql
revoke execute on function public.delete_intake_contact(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_intake_contact(uuid, uuid)
  to service_role;
```

- [ ] **Step 3: Restrict the drafting rollup**

Add:

```sql
revoke execute on function public.drafting_hub_draft_rollups(text[])
  from public, anon, authenticated;
grant execute on function public.drafting_hub_draft_rollups(text[])
  to service_role;
```

- [ ] **Step 4: Replace `mark_messages_read` with caller authorization**

At the start of the `SECURITY DEFINER` function, require either service role or an owning client:

```sql
if coalesce(
  nullif(current_setting('request.jwt.claim.role', true), ''),
  nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
  ''
) <> 'service_role' then
  if auth.uid() is null
     or p_reader_role <> 'client'
     or not (
       exists (
         select 1
         from public.matters m
         where m.id::text = p_matter_id
           and m.client_id = auth.uid()
       )
       or exists (
         select 1
         from public.v_matter_pipeline v
         where v.matter_id::text = p_matter_id
           and v.client_email = (
             select u.email::text from auth.users u where u.id = auth.uid()
           )
       )
     ) then
    raise exception 'Matter access required' using errcode = '42501';
  end if;
end if;
```

Use `SET search_path = pg_catalog, public`, revoke from `PUBLIC` and `anon`, and grant only to `authenticated` and `service_role`.

- [ ] **Step 5: Replace the client document policy**

Drop and recreate `client_read_visible_matter_documents`. Normalize the direct folder value and linked folder name and exclude all internal spellings:

```sql
lower(coalesce(folder, '')) not in (
  'draft', 'drafts', 'meeting-notes', 'meeting_notes', 'meeting notes'
)
```

Apply the same list inside the linked-folder `NOT EXISTS` predicate. Preserve the current matter-client and pipeline-email ownership predicates unchanged.

- [ ] **Step 6: Move lead snoozing into the unique migration**

Copy the nullable column, `snooze_lead_next_action` definition, service-role claim check, attorney/admin actor check, future-time validation, terminal-status guard, activity insert, grants, and schema reload from the colliding migration. Delete `20260811000000_lead_next_action_snooze.sql` after its full behavior is present in the new migration.

- [ ] **Step 7: Run focused database and route tests**

Run:

```bash
npm test -- --run \
  tests/repository-security-remediation.test.ts \
  tests/matter-owned-lead-lifecycle.test.ts \
  tests/lead-details-persistence.test.ts \
  tests/lead-detail-route.test.ts \
  tests/document-security.test.ts \
  tests/drafting-hub.test.ts
```

Expected: PASS, including unique migration versions.

- [ ] **Step 8: Validate migration inventory**

Run:

```bash
./node_modules/.bin/supabase migration list --local
git diff --check
```

Expected: unique ordered local versions and no whitespace errors.

- [ ] **Step 9: Commit the migration**

```bash
git add supabase/migrations tests
git commit -m "fix: close database authorization gaps"
```

### Task 3: Apply and Verify the Hosted Security Migration

**Files:**
- Read: `supabase/migrations/20260812000000_repository_security_remediation.sql`
- No additional repository files.

**Interfaces:**
- Consumes: exact tested migration SQL from Task 2.
- Produces: hosted migration history and verified function ACLs/RLS/schema state.

- [ ] **Step 1: Re-run the focused predeployment gate**

Run the Task 2 focused test command again from the committed tree. Stop if any test fails.

- [ ] **Step 2: Review current hosted state**

Use read-only Supabase queries to record:

```sql
select p.proname,
       pg_get_function_identity_arguments(p.oid) as arguments,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec,
       has_function_privilege('service_role', p.oid, 'execute') as service_exec
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'delete_intake_contact',
    'drafting_hub_draft_rollups',
    'mark_messages_read',
    'snooze_lead_next_action'
  );
```

- [ ] **Step 3: Apply the exact migration once**

Use the connected Supabase migration tool with name `repository_security_remediation` and the exact committed SQL. Do not modify SQL inline during deployment.

- [ ] **Step 4: Verify hosted ACLs and schema**

Query the catalog and require:

```text
delete_intake_contact: anon=false, authenticated=false, service=true
drafting_hub_draft_rollups: anon=false, authenticated=false, service=true
mark_messages_read: anon=false, authenticated=true, service=true
snooze_lead_next_action: anon=false, authenticated=false, service=true
```

Verify `lead_next_action_snoozed_until` exists and inspect `pg_policies.qual` to ensure every meeting-note spelling is excluded.

- [ ] **Step 5: Run hosted security advisors**

Run the Supabase security advisor and confirm it no longer reports anonymous execution for the three remediated definer functions. Record unrelated remaining notices separately; do not broaden this migration.

### Task 4: Replace Firma Query Secrets with Timestamped HMAC

**Files:**
- Modify: `tests/esign.test.ts`
- Modify: `lib/esign/verify.ts`
- Modify: `app/api/webhooks/esign/route.ts:14-110`
- Modify: `lib/esign/firma.ts:7-18`
- Modify if present: `VERCEL_ENV_CHECKLIST.md`

**Interfaces:**
- Produces:

```ts
type FirmaSignatureVerificationInput = {
  payload: string
  signatureHeader: string | null
  oldSignatureHeader?: string | null
  secret: string
  previousSecret?: string
  nowMs?: number
  toleranceSeconds?: number
}

export function verifyFirmaWebhookSignature(
  input: FirmaSignatureVerificationInput,
): boolean
```

- Consumes: `X-Firma-Signature` and optional `X-Firma-Signature-Old`, each formatted as `t=<unix-seconds>,v1=<hex>`.

- [ ] **Step 1: Replace the legacy tests with HMAC tests**

Build signatures using:

```ts
const signedPayload = `${timestamp}.${rawBody}`
const digest = createHmac('sha256', secret).update(signedPayload).digest('hex')
const header = `t=${timestamp},v1=${digest}`
```

Test valid current signature, valid old header, tampered body, wrong secret, malformed header, a timestamp older than 300 seconds, and a timestamp more than 300 seconds in the future. Add route-source assertions that `url.searchParams.get('secret')` is absent and both Firma signature headers are read.

- [ ] **Step 2: Run the signature tests and verify RED**

Run:

```bash
npm test -- --run tests/esign.test.ts
```

Expected: FAIL because only `verifyEsignWebhookSecret` exists.

- [ ] **Step 3: Implement the verification helper**

Parse comma-separated key/value pairs without accepting duplicate `t` or `v1` keys. Require an integer timestamp and a 64-character hexadecimal digest. Reject absolute clock skew above 300 seconds. Compare equal-length digest buffers with `timingSafeEqual`.

Verify the current header with `FIRMA_WEBHOOK_SECRET`. If it fails and both an old header and `FIRMA_WEBHOOK_SECRET_OLD` are configured, verify `X-Firma-Signature-Old` with that previous secret, matching Firma's 24-hour rotation protocol.

- [ ] **Step 4: Wire the route to raw-body verification**

Read `await req.text()` before parsing JSON. Validate:

```ts
verifyFirmaWebhookSignature({
  payload: rawBody,
  signatureHeader: req.headers.get('x-firma-signature'),
  oldSignatureHeader: req.headers.get('x-firma-signature-old'),
  secret,
  previousSecret: process.env.FIRMA_WEBHOOK_SECRET_OLD?.trim(),
})
```

Return 401 before provider or database access when invalid. Remove all query-secret comments and logic.

- [ ] **Step 5: Update integration documentation**

Document `FIRMA_WEBHOOK_SECRET` as the Firma signing secret and the webhook URL without a query parameter:

```text
https://{app}/api/webhooks/esign
```

- [ ] **Step 6: Run focused tests and lint**

Run:

```bash
npm test -- --run tests/esign.test.ts tests/api-route-auth.test.ts tests/engagement-current-flow.test.ts
npx eslint lib/esign/verify.ts lib/esign/firma.ts app/api/webhooks/esign/route.ts tests/esign.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit HMAC verification**

```bash
git add lib/esign app/api/webhooks/esign tests VERCEL_ENV_CHECKLIST.md
git commit -m "fix: verify Firma webhook signatures"
```

### Task 5: Make Firma Event Claims Atomic and Retryable

**Files:**
- Create via CLI, then order after current migrations: `supabase/migrations/20260812010000_firma_webhook_event_claims.sql`
- Modify: `tests/engagement-repository.test.ts`
- Create: `tests/esign-webhook-idempotency.test.ts`
- Modify: `app/api/webhooks/esign/route.ts:150-350`

**Interfaces:**
- Produces a service-role-only RPC:

```sql
public.claim_firma_webhook_event(
  p_event_id text,
  p_firma_request_id text,
  p_event_type text,
  p_payload jsonb,
  p_agreement_id uuid
) returns text
```

Return values are `claimed`, `duplicate`, or `in_progress`.

- [ ] **Step 1: Write failing persistence and behavior tests**

Assert the migration adds `processing_started_at timestamptz`, defines `claim_firma_webhook_event`, revokes it from `PUBLIC, anon, authenticated`, and grants only `service_role`.

In the route behavior test, verify:

```text
claimed     -> process provider state and mark processed_at
duplicate   -> return 200 with duplicate=true
in_progress -> return 202 without repeating side effects
failed/stale claim -> may be reclaimed on a later Firma retry
```

Require payload event `id`; do not fall back to a body hash.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm test -- --run tests/engagement-repository.test.ts tests/esign-webhook-idempotency.test.ts
```

Expected: FAIL because the claim RPC and route behavior do not exist.

- [ ] **Step 3: Generate and implement the claim migration**

Generate with `supabase migration new firma_webhook_event_claims`, then ensure its ordered name is `20260812010000_firma_webhook_event_claims.sql`.

The RPC must atomically:

1. insert a new event with `processing_started_at = statement_timestamp()` and return `claimed`;
2. return `duplicate` when `processed_at` is non-null;
3. return `in_progress` when an unprocessed claim is younger than five minutes; and
4. reclaim an event when `error` is non-null or the claim is at least five minutes old.

Use row locking or `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE` so two deliveries cannot both receive `claimed`.

- [ ] **Step 4: Replace route-side select/insert racing**

Extract the payload event ID from `payload.id` first, with documented legacy event ID fields only as compatibility fallbacks. Reject a state-changing payload with no stable ID. Call the claim RPC before provider reconciliation and branch on its result. On success set `processed_at`; on failure store `error` and leave the event retryable.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- --run \
  tests/esign.test.ts \
  tests/esign-webhook-idempotency.test.ts \
  tests/engagement-repository.test.ts \
  tests/matter-owned-lead-lifecycle.test.ts \
  tests/leads.test.ts
```

Expected: PASS.

- [ ] **Step 6: Apply and verify the hosted claim migration**

Apply the exact tested migration to hosted Supabase. Verify the column, RPC ACLs, and migration history. Do not send a synthetic production webhook or alter an agreement row.

- [ ] **Step 7: Commit idempotency changes**

```bash
git add supabase/migrations app/api/webhooks/esign tests
git commit -m "fix: claim Firma webhook events atomically"
```

### Task 6: Restore DPOA Selection Fidelity

**Files:**
- Modify: `tools/aubreylaw-docgeneration/templates/durable-power-of-attorney.docx`
- Test: `tests/node-estate-generator.test.ts:2789-2840`
- Read: `lib/estateGenerator/toGeneratorData.ts:638-720`

**Interfaces:**
- Consumes:

```text
fiduciaries.agent.primary.full_name
fiduciaries.agent.co_primary.full_name
fiduciaries.agent.co_agents_action
dpoa.self_dealing_reviewer.full_name
dpoa.self_dealing_reviewer_alt.full_name
dpoa.include_section_l
```

- Produces: valid DOCX output whose substantive text matches the selected co-agent, reviewer, and Section L choices.

- [ ] **Step 1: Confirm the existing generator test is RED**

Run:

```bash
npm test -- --run tests/node-estate-generator.test.ts \
  -t "renders DPOA co-agent, self-dealing reviewer, and Section L choices"
```

Expected: FAIL because `CARL COAGENT` is absent.

- [ ] **Step 2: Inspect the template using the documents skill**

Render and inspect the current DPOA template before editing. Locate the agent appointment, co-agent decision, self-dealing review, and Section L paragraphs. Preserve formatting, pagination, execution blocks, and firm-approved surrounding language.

- [ ] **Step 3: Add the exact template conditions**

Use Nunjucks-compatible fields already supported by the generator:

```text
{{ fiduciaries.agent.primary.full_name | upper }}
{{ fiduciaries.agent.co_primary.full_name | upper }}
{{ fiduciaries.agent.co_agents_action }}
{{ dpoa.self_dealing_reviewer.full_name | upper }}
{{ dpoa.self_dealing_reviewer_alt.full_name | upper }}
{% if dpoa.include_section_l %}...Section L approved language...{% endif %}
```

Wrap co-agent and reviewer paragraphs so absent optional people do not leave empty labels or contradictory independent-action language.

- [ ] **Step 4: Run DPOA tests**

Run:

```bash
npm test -- --run tests/node-estate-generator.test.ts \
  -t "DPOA|co-agent arrangement|tag-balanced"
```

Expected: PASS for all co-agent arrangements and the reviewed selection case.

- [ ] **Step 5: Render and visually inspect representative output**

Render at least independent, joint, and majority co-agent variants. Confirm the DOCX files open, Section L appears only when enabled, and no unresolved tags or contradictory decision clauses remain.

- [ ] **Step 6: Commit the DPOA template**

```bash
git add tools/aubreylaw-docgeneration/templates/durable-power-of-attorney.docx tests/node-estate-generator.test.ts
git commit -m "fix: render selected DPOA provisions"
```

### Task 7: Restore HCP and HIPAA Selection Fidelity

**Files:**
- Modify: `tools/aubreylaw-docgeneration/templates/health-care-proxy.docx`
- Modify: `tools/aubreylaw-docgeneration/templates/hipaa-authorization.docx`
- Test: `tests/node-estate-generator.test.ts:2842-2888`
- Read: `lib/estateGenerator/toGeneratorData.ts:723-770`

**Interfaces:**
- Consumes:

```text
healthcare.anatomical_gift
healthcare.anatomical_specified
hipaa.psychotherapy_notes
```

- Produces: HCP and HIPAA text matching the selected authorization choices.

- [ ] **Step 1: Confirm the existing HCP/HIPAA test is RED**

Run:

```bash
npm test -- --run tests/node-estate-generator.test.ts \
  -t "renders HCP anatomical gift and HIPAA psychotherapy choices"
```

Expected: FAIL because the specified cornea gift is absent.

- [ ] **Step 2: Add HCP anatomical-gift branches**

Condition the approved gift paragraphs on `healthcare.anatomical_gift`. For the `specified` branch, render:

```text
{{ healthcare.anatomical_specified }}
```

and the corresponding limited-purpose language. Ensure the broad “any purpose” sentence is excluded in that branch.

- [ ] **Step 3: Add HIPAA psychotherapy branches**

For the authorize value, include the approved mental-illness, psychotherapy-notes, and dependency authorization and omit “except psychotherapy notes.” For the non-authorize value, preserve the exclusion.

- [ ] **Step 4: Run focused generator tests**

Run:

```bash
npm test -- --run tests/node-estate-generator.test.ts \
  -t "HCP|HIPAA|incapacity documents package|incapacity-only"
```

Expected: PASS without unresolved tags.

- [ ] **Step 5: Render and visually inspect both choice variants**

Inspect specified versus general anatomical gifts and authorize versus exclude psychotherapy notes. Confirm only the selected language appears.

- [ ] **Step 6: Commit the HCP/HIPAA templates**

```bash
git add \
  tools/aubreylaw-docgeneration/templates/health-care-proxy.docx \
  tools/aubreylaw-docgeneration/templates/hipaa-authorization.docx \
  tests/node-estate-generator.test.ts
git commit -m "fix: render selected health care provisions"
```

### Task 8: Make Estate Summaries Package-Aware

**Files:**
- Modify: `lib/estateGenerator/toGeneratorData.ts:330-376`
- Modify: `lib/estateGenerator/context.ts`
- Modify: `tools/aubreylaw-docgeneration/templates/estate-plan-summary.docx`
- Test: `tests/node-estate-generator.test.ts:2660-2752`

**Interfaces:**
- Produces these template flags:

```ts
summary: {
  show_spouse: boolean
  show_dpoa_agent: boolean
  show_healthcare_agent: boolean
}
```

- [ ] **Step 1: Tighten the failing summary tests**

For guardian-only and young-adult generation, assert both:

```ts
expect(result.missing).toEqual([])
expect(xmlFromDocx(summary.buffer)).not.toContain('[[ MISSING:')
```

Add assertions that a full incapacity package still contains the DPOA and healthcare rows.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npm test -- --run tests/node-estate-generator.test.ts \
  -t "parental guardian|young adult|estate plan summary"
```

Expected: guardian-only reports spouse and agent fields; young-adult reports agent fields.

- [ ] **Step 3: Derive summary visibility from selected packages**

Set flags from actual document inclusions and household data:

```ts
show_spouse: Boolean(payload.spouse)
show_dpoa_agent: Boolean(
  payload.documents.include_dpoa && payload.fiduciaries.dpoa_primary
)
show_healthcare_agent: Boolean(
  payload.documents.include_hcp && payload.fiduciaries.hcp_primary
)
```

If the young-adult combined package needs its own subject-specific summary data, omit the parent-level agent rows rather than displaying the parents' missing fiduciaries.

- [ ] **Step 4: Condition the summary rows**

Wrap each spouse, DPOA, and healthcare row in its matching `summary.show_*` condition. Preserve existing full-plan headings and content.

- [ ] **Step 5: Run summary and full generator tests**

Run:

```bash
npm test -- --run tests/node-estate-generator.test.ts
```

Expected: all generator tests pass.

- [ ] **Step 6: Commit package-aware summaries**

```bash
git add lib/estateGenerator tools/aubreylaw-docgeneration/templates/estate-plan-summary.docx tests/node-estate-generator.test.ts
git commit -m "fix: make estate summaries package-aware"
```

### Task 9: Remove Render-Time Ref Mutation

**Files:**
- Modify: `app/admin/drafting/[matterId]/design/DesignSheetShell.tsx:221-235`
- Modify: `app/admin/drafting/[matterId]/design/DesignSectionPageView.tsx:45-56`
- Modify: `app/admin/drafting/[matterId]/design/ExpressDesignSheet.tsx:193-200`
- Modify: `components/softphone/Softphone.tsx:467-720`
- Test: existing design-sheet and softphone interaction tests.

**Interfaces:**
- Preserves public component props and behavior.
- Produces render-pure components accepted by `react-hooks/refs`.

- [ ] **Step 1: Capture the lint RED state**

Run:

```bash
npx eslint \
  'app/admin/drafting/[matterId]/design/DesignSheetShell.tsx' \
  'app/admin/drafting/[matterId]/design/DesignSectionPageView.tsx' \
  'app/admin/drafting/[matterId]/design/ExpressDesignSheet.tsx' \
  components/softphone/Softphone.tsx
```

Expected: `react-hooks/refs` errors at the reviewed lines.

- [ ] **Step 2: Move section scroll resets into layout effects**

Use the section ID as an effect dependency and reset before restoring DOM scroll:

```ts
useLayoutEffect(() => {
  if (previousSectionIdRef.current !== sectionId) {
    previousSectionIdRef.current = sectionId
    scrollTopRef.current = 0
  }
  const container = scrollContainerRef.current
  if (container) container.scrollTop = scrollTopRef.current
}, [sectionId])
```

Apply the same pattern to shell and page view.

- [ ] **Step 3: Make fast-entry ordering state-driven**

Replace render-time ref writes with state and an effect:

```ts
const [sectionOrder, setSectionOrder] = useState<string[]>([])
const orderedSections = useMemo(
  () => preserveFastEntrySectionOrder(sections, sectionSummaries, sectionOrder),
  [sectionOrder, sectionSummaries, sections],
)
useEffect(() => {
  const next = orderedSections.map(section => section.id)
  setSectionOrder(current => arraysEqual(current, next) ? current : next)
}, [orderedSections])
```

Use or add a small equality helper so the effect does not loop.

- [ ] **Step 4: Replace softphone render-time ref reads**

Mirror direction, participant number, and provider in reactive state at the same transitions that currently assign their refs. Continue retaining refs only for callback freshness. Derive `activeEntry`, participant display, and hold availability from state during render.

- [ ] **Step 5: Run focused tests and lint**

Run the nearest design-sheet navigation/scroll, fast-entry, and softphone tests discovered with:

```bash
rg -l "DesignSheetShell|DesignSectionPageView|ExpressDesignSheet|Softphone" tests
```

Then run those test files plus the four-file ESLint command. Expected: PASS with no `react-hooks/refs` errors.

- [ ] **Step 6: Commit render-purity fixes**

```bash
git add app/admin/drafting components/softphone tests
git commit -m "fix: keep render paths free of ref mutation"
```

### Task 10: Make Runtime and Typecheck Support Truthful

**Files:**
- Modify: `package.json:5-7`
- Create: `.nvmrc`
- Modify: `tests/appointment-availability.test.ts`
- Modify: `tests/appointment-booking.test.ts`
- Modify: `tests/firma-engagement-poc.test.ts`

**Interfaces:**
- Produces a supported Node range of `>=22 <26` and a default local major of `22`.
- Preserves production type definitions; only stale test fixtures are corrected.

- [ ] **Step 1: Pin the runtime range**

Set:

```json
"engines": {
  "node": ">=22 <26"
}
```

Create `.nvmrc` containing:

```text
22
```

- [ ] **Step 2: Run typecheck and record exact RED failures**

Run:

```bash
npm run typecheck
```

Expected: readonly appointment tuple mismatches, an incomplete appointment fixture, and the Firma test environment typing error.

- [ ] **Step 3: Repair test fixtures without widening production types**

Convert readonly tuple fixtures to the mutable shape expected by the tested boundary, add the newly required appointment fields to the booking fixture, and set/restore `NODE_ENV` through a typed test helper rather than assigning through an incompatible `ProcessEnv` fixture.

- [ ] **Step 4: Run typecheck and affected tests**

Run:

```bash
npm run typecheck
npm test -- --run \
  tests/appointment-availability.test.ts \
  tests/appointment-booking.test.ts \
  tests/firma-engagement-poc.test.ts
```

Expected: PASS.

- [ ] **Step 5: Verify a build on Node 22**

Activate Node 22 using the available version manager, then run:

```bash
node --version
npm run build:next
```

Expected: Node `v22.x` and a successful Next.js production build.

- [ ] **Step 6: Commit runtime and fixture fixes**

```bash
git add package.json package-lock.json .nvmrc tests
git commit -m "fix: align runtime and typecheck support"
```

### Task 11: Final Repository and Hosted Verification

**Files:**
- No planned production edits; fix only regressions caused by Tasks 1-10.

**Interfaces:**
- Consumes: all completed phases.
- Produces: final evidence suitable for release review.

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all tests pass. Investigate any failure before proceeding; do not classify a failure as baseline without comparing it to the pre-remediation evidence.

- [ ] **Step 2: Run full lint and typecheck**

```bash
npm run lint
npm run typecheck
```

Expected: both pass without errors.

- [ ] **Step 3: Run the production build under Node 22**

```bash
npm run build:next
```

Expected: successful build.

- [ ] **Step 4: Re-run hosted database verification**

Confirm the two new migration versions, RPC ACLs, meeting-note policy, snooze schema, and security advisors. Perform read-only queries only; do not invoke destructive RPCs against production records.

- [ ] **Step 5: Inspect the final repository state**

```bash
git status -sb
git diff --check
git log --oneline --decorate -12
```

Expected: clean worktree, no whitespace errors, and one reviewable commit per remediation phase.

- [ ] **Step 6: Request final code review**

Use the `superpowers:requesting-code-review` skill against the complete commit range. Resolve every confirmed P0/P1 issue and re-run the affected verification before declaring completion.
