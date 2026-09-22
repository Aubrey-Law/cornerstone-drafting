# Cornerstone Drafting — Operations Runbook

Operator procedures for the internal drafting app. Read this when something breaks or before go-live checks.

---

## Part 1 — Data durability checklist

Re-verify quarterly.

### Supabase

| Check | Where | Pass criteria |
|---|---|---|
| **PITR enabled** | Project Settings → Add-ons | 7-day retention minimum on production. |
| **Backup restore tested** | Database → Backups | Restore into a scratch project; confirm `matters`, `design_sheets`, `matter_documents`, `document_access_audit` exist. |
| **Service-role rotation plan** | Project Settings → API | Document rotation for `SUPABASE_SERVICE_ROLE_KEY` in Vercel + local `.env.local`. |
| **Email confirmation** | Authentication → Email | Confirm email ON for staff accounts. |

### Cloudflare R2

| Check | Where | Pass criteria |
|---|---|---|
| **Object versioning** | Bucket → Settings | Enabled — protects against accidental deletes from document routes. |
| **Bucket private** | Settings → Public access | Disabled; access via presigned URLs only. |
| **CORS allowlist** | Settings → CORS | Production/staging hosts + `localhost:3002` for dev. |
| **Token scope** | API tokens | Scoped to the documents bucket only. |

### Vercel

| Check | Where | Pass criteria |
|---|---|---|
| **Environment isolation** | Environment Variables | Production vs Preview use different R2/keys where data differs. |
| **Secrets not in repo** | — | `.env.local` git-ignored; shape documented in `VERCEL_ENV_CHECKLIST.md`. |
| **Healthcheck** | Deployment / synthetic monitor | `GET /api/health` → 200; `?check=full` probes Supabase + R2. |

---

## Part 2 — Break-glass procedures

### Scenario A — Admin locked out of drafting

**Symptom:** Cannot sign in at `/auth/login`.

1. Supabase Studio → Authentication → Users → find admin email.
2. Send magic link or reset password.
3. If `public.users` row missing:
   ```sql
   insert into public.users (id, email, role)
   values ('<auth-user-id>', 'scott@aubreylegal.com', 'attorney')
   on conflict (id) do update set role = excluded.role;
   ```
4. Post-login destination is `/admin/drafting`.

**Do not** create a second admin UUID — it orphans audit rows keyed by `user_id`.

#### Google OAuth shows 404 or bounces back to login

1. Run `node scripts/validateOAuth.mjs https://cornerstone.aubreylegal.com` (or your host).
2. **Google returns to login with `auth_failed`** — confirm Google Cloud OAuth client lists  
   `https://<ref>.supabase.co/auth/v1/callback` as an authorized redirect URI.
3. Confirm Supabase **Redirect URLs** include `https://<your-host>/auth/callback` for every deployment host.
4. Account must be `role IN ('attorney','admin')` in `public.users` with an `@aubreylegal.com` email.

#### Google sign-in succeeds but lands you in the *other* app

**Symptom:** you click "Continue with Google" on the workbench, authenticate
normally, and arrive signed in — at the root Cornerstone app instead.

This is the same missing **Redirect URLs** entry as item 4 above, but it does
not look like a failure, so it is worth its own line. When Supabase is handed a
`redirect_to` that is not on the allow-list it does not error and does not log
anything: it silently discards it and uses **Site URL**, which is the root app.
Sign-in genuinely succeeded; only the destination was overridden.

Fix: Supabase Dashboard → Authentication → **URL Configuration** → *Redirect
URLs*. Both apps share one Supabase project, so every host of **both** must be
listed. `supabase/config.toml`'s `additional_redirect_urls` is the written
record of what that list should contain, and
`tests/auth-redirect-allowlist.test.ts` keeps it from drifting again — but
neither can read the dashboard, so the dashboard is a manual step.

Note the workbench's production domain drops the dot from the Vercel project
name: the project is `cornerstone-drafting-2.0`, the domain is
`cornerstone-drafting-20.vercel.app`.

**Use the wildcard form — an exact URL is not a safer version of the same
entry, it is a broken one.** Redirect URLs are glob patterns. An entry of
`https://host/auth/callback` matches that URL and nothing else, query string
included, and both apps append `?redirectTo=<path>` to the callback whenever
the visitor reached the login page by being bounced off a gated URL. So an
exact entry works when you type `/auth/login` yourself and fails when you click
a link into the app — the same host, the same account, silently landing in the
other app. Write it as:

```
https://cornerstone-drafting-20.vercel.app/**
```

**How to check the list without guessing.** `auth.flow_state.referrer` stores
the redirect Supabase actually *validated*, and stores `site_url` instead when
it rejects one. Start a sign-in (you can stop at Google's page — the row is
already written) and read the newest row:

```sql
select created_at, referrer from auth.flow_state order by created_at desc limit 5;
```

The full URL means the pattern matched. Bare `site_url` means it did not. This
is the only external read of the hosted allow-list there is; the dashboard
cannot be queried, and the `/auth/v1/authorize` response is no use — it echoes
`redirect_to` back unvalidated, so even `https://evil.example` looks accepted
there.

---

### Scenario B — Draft generation fails for all matters

**Symptom:** Generate step returns 500 or empty file list.

1. Check Vercel logs for `[draft]` / `[estate-generator]` errors.
2. Verify env:
   - `R2_*` credentials and bucket name
   - `ESTATE_GENERATOR_ENGINE` (default `node`)
3. Confirm the configured Node generator or Supabase Storage templates are available.
4. Test health: `curl -s "$HOST/api/health?check=full" | jq .`
5. Fallback: set `ESTATE_GENERATOR_ENGINE=supabase` if Node packages fail but Storage templates exist.
6. If template rendering fails outright, the run now returns the error rather than drafting the
   documents with the model. That fallback is opt-in via `ESTATE_DRAFT_LLM_FALLBACK_ENABLED=true`
   and should stay off: it writes model-authored text into a client's will or trust, and the
   drafts it produces are labelled `llm_fallback` and badged "AI-drafted" in Review. Prefer
   fixing the template.

---

### Scenario C — Documents missing after upload

**Symptom:** Upload succeeds in UI but file 404 on download.

1. Confirm row in `matter_documents` (Supabase Studio).
2. Confirm `r2_key` object exists in R2 console.
3. Check `document_access_audit` for recent errors.
4. If R2 object missing but DB row exists — re-upload; consider versioning restore.

---

## Part 3 — Deployment

1. Merge to main → Vercel production deploy.
2. Build runs the estate-generator preflight + Next build (see `vercel.json`).
3. No migration reset on shared firm database. Migrations in the same push are
   applied by `.github/workflows/db-migrate-deploy.yml`, which runs alongside the
   Vercel build rather than before it — see supabase/migrations/README.md.
4. After deploy: `/api/health?check=full` and sign-in smoke test.

### Massachusetts estate-clause library rollout

`ESTATE_CLAUSE_SOURCE=file` is the safe default and rollback path. Do not set
the production value to `database` until every step below is complete. The
import is intentionally non-publishing: legal text becomes usable only after
an attorney deliberately previews and publishes the submitted revision. In
this solo-attorney deployment, the revision author may complete that review.

1. **Apply and inspect the schema.** In a local or preview-linked environment,
   inspect the pending migration before applying it:

   ```bash
   npx supabase migration list
   npx supabase db push --dry-run
   npx supabase db push
   ```

   Never run `supabase db reset` against the shared firm database. If live
   objects already exist, stop. Reconcile migration history and inspect the
   existing objects instead of replaying non-idempotent DDL.

   Using the project's Supabase SQL editor or another established read-only
   connection, verify all eight tables, all ten service-role RPCs, RLS,
   immutable-history triggers, publication pointer, and manifest indexes:

   ```sql
   select c.relname as table_name, c.relrowsecurity as rls_enabled
   from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = any (array[
       'estate_clauses', 'estate_clause_working_drafts',
       'estate_clause_revisions', 'estate_clause_review_events',
       'estate_clause_publications', 'estate_clause_preview_evidence',
       'matter_estate_clause_overrides',
       'generated_document_clause_revisions'
     ])
   order by c.relname;

   select p.proname, p.prosecdef, p.proconfig,
          has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
          has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute
   from pg_catalog.pg_proc p
   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = any (array[
       'submit_estate_clause_revision', 'request_estate_clause_changes',
       'publish_estate_clause_revision', 'record_estate_clause_preview',
       'retire_estate_clause_publication', 'revert_estate_clause_publication',
       'upsert_matter_estate_clause_override', 'retire_matter_estate_clause_override',
       'load_estate_clause_generation_snapshot',
       'persist_generated_estate_document'
     ])
   order by p.proname;

   select trigger_name, event_object_table
   from information_schema.triggers
   where trigger_schema = 'public'
     and trigger_name = any (array[
       'estate_clause_revisions_immutable',
       'estate_clause_review_events_immutable',
       'estate_clause_preview_evidence_immutable',
       'matter_estate_clause_overrides_immutable',
       'generated_document_clause_revisions_immutable',
       'estate_clause_publications_serialized',
       'estate_template_publications_serialized',
       'estate_clause_key_stable_after_use'
     ])
   order by trigger_name;

   select tablename, policyname, roles, cmd
   from pg_catalog.pg_policies
   where schemaname = 'public'
     and tablename = any (array[
       'estate_clauses', 'estate_clause_working_drafts',
       'estate_clause_revisions', 'estate_clause_review_events',
       'estate_clause_publications', 'estate_clause_preview_evidence',
       'matter_estate_clause_overrides',
       'generated_document_clause_revisions'
     ])
   order by tablename, policyname;

   select conname, pg_catalog.pg_get_constraintdef(oid) as definition
   from pg_catalog.pg_constraint
   where conrelid = 'public.estate_clause_publications'::regclass
   order by conname;

   select indexname, tablename
   from pg_catalog.pg_indexes
   where schemaname = 'public'
     and indexname = any (array[
       'estate_clause_revisions_clause_idx',
       'estate_clause_review_events_revision_idx',
       'matter_estate_clause_overrides_matter_idx',
       'generated_document_clause_revisions_revision_idx',
       'generated_document_clause_revisions_document_idx',
       'generated_document_clause_revisions_position_idx'
     ])
   order by indexname;
   ```

   Pass criteria: eight RLS-enabled tables; ten `SECURITY DEFINER` RPCs with
   `search_path` fixed to an empty value; `anon_execute=false`,
   `authenticated_execute=false`, and `service_role_execute=true` for each RPC;
   eight immutable/stability/serialization triggers, a composite publication pointer from
   `(current_revision_id, clause_id)` to the same immutable revision, eight
   read policies, and six named indexes. Table grants and RLS policies are
   separate controls and both must remain present.

2. **Stage the bundled baseline without publishing.** First verify the import
   payload without a database connection, then run the idempotent import with
   an attorney/admin actor in the local or preview database:

   ```bash
   npm run clauses:import -- --dry-run
   ATTORNEY_USER_UUID="paste-attorney-user-uuid-here"
   ESTATE_CLAUSE_IMPORT_ACTOR_ID="$ATTORNEY_USER_UUID" npm run clauses:import
   ```

   Expected: `bundled=22`, `requiresReview=22`, and `publications=0`. A repeat
   must not create duplicates or overwrite an attorney-modified working draft.

3. **Attorney review and publication.** Sign in to the clause-library UI as the
   attorney/admin. Correct validation failures and submit each working draft.
   For each submitted revision, compare the proposed and published language,
   generate and inspect the representative preview, type the exact stable key,
   and explicitly publish the approved revision. Self-authored publication is
   permitted, but submission and publication remain separate audited actions.
   Bundled clauses marked `draft` remain unpublished until their language
   receives affirmative attorney approval.

4. **Refresh and run the release gate.** Export a read-only local snapshot into
   `tests/fixtures/estate-clause-database-cutover.json`. It must contain sorted
   `stagedClauseKeys` and current `activePublications` with `clauseKey`,
   `reviewStatus`, `contentHash`, and `text`. Do not put credentials, user IDs,
   client data, or comments in this fixture. Run this read-only query in the
   local Supabase SQL editor and save its single JSON value as that file:

   ```sql
   with active as (
     select c.clause_key,
            case when exists (
              select 1 from public.estate_clause_review_events e
              where e.clause_id = c.id
                and e.revision_id = p.current_revision_id
                and e.event_type = 'published'
            ) then 'published' else 'draft' end as review_status,
            r.content_hash,
            r.clause_text
     from public.estate_clause_publications p
     join public.estate_clauses c on c.id = p.clause_id
     join public.estate_clause_revisions r
       on r.id = p.current_revision_id and r.clause_id = p.clause_id
     where c.is_active and c.jurisdiction = 'MA'
   )
   select pg_catalog.jsonb_pretty(pg_catalog.jsonb_build_object(
     'capturedFrom', 'local Supabase after deliberate attorney review',
     'stagedClauseKeys', coalesce((
       select pg_catalog.jsonb_agg(c.clause_key order by c.clause_key)
       from public.estate_clauses c where c.jurisdiction = 'MA'
     ), '[]'::jsonb),
     'activePublications', coalesce((
       select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
         'clauseKey', a.clause_key,
         'reviewStatus', a.review_status,
         'contentHash', a.content_hash,
         'text', a.clause_text
       ) order by a.clause_key) from active a
     ), '[]'::jsonb)
   ));
   ```

   Then run:

   ```bash
   npx vitest run tests/estate-clause-parity.test.ts -t "database cutover readiness"
   ```

   The gate must report no missing representative-template publications, no
   draft publication, and no unexplained database/file rendering difference.
   Intentional differences require a committed clause-key entry and reason in
   `intentionalDifferences`. The checked-in pre-review fixture intentionally
   has zero active publications, so this gate remains red until the human legal
   review above is complete.

   Because it is red by design, the gate is **opt-in** and does not run in the
   default `npm test` (a permanently failing suite hides real regressions). Run
   it deliberately at cutover time:

   ```bash
   ESTATE_CLAUSE_CUTOVER_GATE=1 npx vitest run tests/estate-clause-parity.test.ts
   ```

5. **Verify in preview.** Run the focused suite documented in the implementation
   plan. Set `ESTATE_CLAUSE_SOURCE=database` only in a preview deployment, then
   generate and inspect representative Massachusetts Will, Trust, durable POA,
   Health Care Proxy/directive, and HIPAA packages. Confirm each included clause
   has one ordered manifest row, each attorney force-omit has one immutable
   `included=false` manifest row, condition-false clauses have no manifest row,
   and regeneration preserves the
   earlier document version and manifest, and a newly published revision affects
   only later generations. Missing or corrupt publications must block generation
   without falling back to bundled JSON.

6. **Promote deliberately.** Only after the preview gate and document inspection
   pass, set `ESTATE_CLAUSE_SOURCE=database` in production and redeploy. Repeat
   the health, sign-in, package-generation, manifest, and download checks. Record
   the reviewers, fixture commit, preview deployment, and production deployment
   in the release record.

#### Estate-clause rollback

Set `ESTATE_CLAUSE_SOURCE=file` in the affected Vercel environment and redeploy.
Generate a representative package and confirm it matches pre-feature file-source
output. Never delete publications, revisions, review events, overrides, or
generated-document manifest history. Investigate and correct the database path,
rerun the release gate in preview, and perform a new deliberate cutover.

---

## Part 4 — Local development

```bash
npm ci
cp .env.local.save .env.local  # if available
npm run dev                    # http://localhost:3002
```

Run verification:

```bash
npm run typecheck
npm test
```

For local Supabase with the drafting baseline only:

```bash
supabase start
supabase db reset
# seed test matters before using the hub
```

---

## Part 5 — Billing milestones and durable workflow jobs

The solo-practice billing migration is additive. Do not apply it to the linked firm database without explicit approval, and do not backfill existing matters automatically.

Rollout order:

1. Replay migrations locally and run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build:next`, and `npm run audit:render-matrix`.
2. Verify the direct-pay, legal-plan, College Preparation, and Probate fixtures in an authenticated browser.
3. Apply the migration in an approved staging environment and leave all three new `firm_settings` flags off.
4. Enable `durable_workflow_jobs_enabled`; verify `/api/cron/workflow-jobs` claims, retries, and exposes terminal failures on Today.
5. Enable `probate_track_enabled`; open a test Probate matter and confirm the dedicated checklist.
6. Enable `billing_milestones_enabled`; accept a new direct-pay test matter and confirm the exact two-phase split. Existing charges and invoices must remain unchanged.

Operational rules:

- Stripe is the only supported online processor. `PAYMENTS_PROVIDER=lawpay` is rejected until LawPay checkout, webhooks, refunds, and funds-handling policy are complete.
- The workflow cron runs every five minutes and requires `CRON_SECRET`. Failed jobs stop after their configured retry count and require the authenticated manual retry endpoint.
- Overdue reminders are drafts only. A staff user must approve each reminder; no cron path sends them.
- Matter close-out is rejected server-side while direct-pay balances, ready milestones, open legal-plan claims, or payment exceptions remain. A financial exception requires an attorney-authored reason.
- Cost items represent incurred costs only. The operating-account workflow does not accept advance cost deposits or trust funds.
- Paid portal invoices serve as downloadable receipts on `/account`; verified Stripe payments also trigger a receipt email.

## Part 6 — Twilio softphone (browser Voice + call logging)

### Telnyx replacement and rollback

Cornerstone can select SMS and voice providers independently with `SMS_PROVIDER`
and `VOICE_PROVIDER`. Use `telnyx` for the new number; use `twilio` for rollback.

For Telnyx, create a Messaging Profile and Credential Connection, assign the new
number to both, complete 10DLC or toll-free verification, and create one
telephony credential per staff user. Set the credential IDs in
`TELNYX_TELEPHONY_CREDENTIAL_IDS` as a JSON object keyed by Supabase user UUID.

Configure:

| Telnyx portal setting | Cornerstone URL |
|---|---|
| Messaging primary webhook | `https://<host>/api/webhooks/telnyx/messaging` |
| Voice connection webhook | `https://<host>/api/webhooks/telnyx/voice` |

Verify `GET /api/admin/communications/status`, then test outbound/inbound SMS,
STOP handling, browser inbound/outbound calls, DTMF, mute, hangup, and webhook
redelivery before switching production provider flags. Telnyx fallback routing,
ring timeout, and recording must also be enabled on the Telnyx connection using
the matching `TELNYX_*` environment settings.

Cornerstone uses the same Twilio browser softphone stack as the full portal. Configuration is **env-only** (no Settings UI).

### Environment variables

See [`VERCEL_ENV_CHECKLIST.md`](VERCEL_ENV_CHECKLIST.md) — required for Voice:

| Variable | Purpose |
|---|---|
| `TWILIO_ACCOUNT_SID` | Account |
| `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | Browser Voice SDK JWT |
| `TWILIO_TWIML_APP_SID` | Outbound softphone TwiML App |
| `TWILIO_CALLER_ID` | Outbound caller ID |
| `TWILIO_AUTH_TOKEN` | Webhook signature verification |
| `TWILIO_INBOUND_CLIENT_IDENTITIES` | Comma-separated Supabase staff user UUIDs to ring on inbound |
| `TWILIO_INBOUND_FALLBACK_URL` | Optional Retell/Smith.ai fallthrough when no answer |
| `TWILIO_INBOUND_RING_TIMEOUT` | Seconds before fallback (default 20) |
| `NEXT_PUBLIC_APP_URL` | Public host for status callbacks |

The admin FAB is hidden when Voice env is incomplete (`isTwilioVoiceConfigured()` in `lib/twilio/config.ts`).

### Twilio Console wiring

| Resource | Voice URL |
|---|---|
| TwiML App (outbound softphone) | `https://<host>/api/voice` |
| Business line (inbound) | `https://<host>/api/voice/inbound` |
| Status callbacks (automatic via code) | `https://<host>/api/webhooks/twilio/voice-status` |
| Retell webhook (if used) | `https://<host>/api/webhooks/retell` |

Post-call alerts (`call_analyzed`): email via `RETELL_SUMMARY_TO`, SMS via `RETELL_SUMMARY_SMS_TO` (see `VERCEL_ENV_CHECKLIST.md`).

### Staff identity for inbound ring

1. Supabase Studio → Authentication → Users → copy the staff user's UUID.
2. Set `TWILIO_INBOUND_CLIENT_IDENTITIES=<uuid>` (comma-separate for multiple attorneys).
3. The same UUID is used as the Twilio Client identity in `GET /api/token` (admin JWT → `user.id`).

### Smoke test checklist

0. **Env audit (admin):** while signed in, `GET /api/admin/twilio/status` returns which Voice/SMS variables are missing (no secret values). Useful when the phone FAB is hidden or inbound does not ring.
1. Sign in as staff → confirm phone FAB appears (when Voice env complete).
2. Open FAB → token loads → dial a test number → call connects.
3. Confirm row in `calls` table and entry on `/admin/calls`.
4. Open a matter → **Calls** tab → assigned/unassigned call appears.
5. Inbound: call business line → browser rings → answer → status webhook logs call.

### Code map

- UI: `components/softphone/Softphone.tsx`, `app/admin/components/StaffSoftphone.tsx`
- Token: `app/api/token/route.ts`
- TwiML: `app/api/voice/route.ts`, `app/api/voice/inbound/route.ts`, `app/api/voice/inbound-fallback/route.ts`
- Logging: `app/api/webhooks/twilio/voice-status/route.ts`, `app/api/webhooks/retell/route.ts`

## Part 7 — Push to Lawmatics

Staff can push a lead or client to Lawmatics from **Push to Lawmatics** in the
lead's "More actions" menu or the matter's "More actions" menu
(`POST /api/lawmatics/push`, `lib/integrations/lawmatics/push.ts`). The first
push creates a Lawmatics prospect; later pushes update the same prospect. The
link is shared with appointment sync and with legacy Lawmatics imports
(`client_intake.lawmatics_matter_id`), so a push never creates a duplicate. If
an earlier create's outcome is unknown, the push stops and asks for review
instead of posting again. Blank Cornerstone values are left out, so a push never
clears a value someone typed into Lawmatics.

The push only needs Lawmatics connected; it does not depend on
`lawmatics_appointment_sync_enabled`.

**Standard fields** always go, under Lawmatics' own contact attribute names (as
its document merge-field reference lists them): first, middle and last name,
suffix (`name_suffix`), preferred name (`informal_name`), email, phone,
birthdate, street, address line 2 (`street2`), city, state, ZIP (`zipcode`),
marital status, occupation, employer, citizenship.

**Everything else** (county, preferred pronouns, date of marriage, spouse
details, children, lead/referral source, practice area, plan type, lead status,
estate value, legal plan member ID, planning objectives, special/qualification/
internal notes, matter number) goes to Lawmatics custom
fields. A custom field's ID is the number in its merge field on Lawmatics'
document reference page (`{{custom_field_930886}}` → `930886`). Paste it next to the Cornerstone field in **Settings → Lawmatics**
(`/admin/settings?tab=lawmatics`, which also shows the connection and a
Connect/Reconnect button). The page saves `integration_settings.lawmatics_custom_field_id_map`,
keyed by the Cornerstone keys in `LAWMATICS_PUSH_FIELDS`
(`lib/integrations/lawmatics/pushFields.ts`). The equivalent SQL, if the page is unavailable:

```sql
update public.integration_settings
set lawmatics_custom_field_id_map = '{"county": "12345", "spouse_first_name": "12346"}'::jsonb
where id = 1;
```

Unmapped fields are skipped. The success toast lists the ones that had a value
but no mapping.
