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

#### OAuth (Google / Microsoft) shows 404 or bounces back to login

1. Run `node scripts/validateOAuth.mjs https://cornerstone.aubreylegal.com` (or your host).
2. **Microsoft 404** — Supabase is generating a broken authorize URL like  
   `https://<ref>.supabase.co/auth/v1/callback/oauth2/v2.0/authorize`.  
   Fix: Supabase Dashboard → Authentication → Providers → **Azure** → set **Azure Tenant URL** to  
   `https://login.microsoftonline.com/common` (or your org tenant).  
   Do **not** put the Supabase `/auth/v1/callback` URL in the tenant field.
3. **Google returns to login with `auth_failed`** — confirm Google Cloud OAuth client lists  
   `https://<ref>.supabase.co/auth/v1/callback` as an authorized redirect URI.
4. Confirm Supabase **Redirect URLs** include `https://<your-host>/auth/callback` for every deployment host.
5. Account must be `role IN ('attorney','admin')` in `public.users` with an `@aubreylegal.com` email.

---

### Scenario B — Draft generation fails for all matters

**Symptom:** Generate step returns 500 or empty file list.

1. Check Vercel logs for `[draft]` / `[estate-generator]` errors.
2. Verify env:
   - `R2_*` credentials and bucket name
   - `ESTATE_GENERATOR_ENGINE` (default `node`)
3. On Vercel, confirm `npm run estate-generator:setup` succeeded in build logs (Python venv only needed for `python` engine).
4. Test health: `curl -s "$HOST/api/health?check=full" | jq .`
5. Fallback: set `ESTATE_GENERATOR_ENGINE=supabase` if Node packages fail but Storage templates exist.

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
2. Build runs Python venv setup + Next build (see `vercel.json`).
3. No migration reset on shared firm database — app-only deploys are normal.
4. After deploy: `/api/health?check=full` and sign-in smoke test.

### Massachusetts estate-clause library rollout

`ESTATE_CLAUSE_SOURCE=file` is the safe default and rollback path. Do not set
the production value to `database` until every step below is complete. The
import is intentionally non-publishing: legal text becomes usable only after a
different attorney or administrator independently publishes the revision.

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
   connection, verify the seven tables, all five service-role RPCs, RLS,
   immutable-history triggers, publication pointer, and manifest indexes:

   ```sql
   select c.relname as table_name, c.relrowsecurity as rls_enabled
   from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = any (array[
       'estate_clauses', 'estate_clause_working_drafts',
       'estate_clause_revisions', 'estate_clause_review_events',
       'estate_clause_publications', 'matter_estate_clause_overrides',
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
       'publish_estate_clause_revision', 'upsert_matter_estate_clause_override',
       'persist_generated_estate_document'
     ])
   order by p.proname;

   select trigger_name, event_object_table
   from information_schema.triggers
   where trigger_schema = 'public'
     and trigger_name = any (array[
       'estate_clause_revisions_immutable',
       'estate_clause_review_events_immutable',
       'estate_clause_key_stable_after_use'
     ])
   order by trigger_name;

   select tablename, policyname, roles, cmd
   from pg_catalog.pg_policies
   where schemaname = 'public'
     and tablename = any (array[
       'estate_clauses', 'estate_clause_working_drafts',
       'estate_clause_revisions', 'estate_clause_review_events',
       'estate_clause_publications', 'matter_estate_clause_overrides',
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
       'generated_document_clause_revisions_document_idx'
     ])
   order by indexname;
   ```

   Pass criteria: seven RLS-enabled tables; five `SECURITY DEFINER` RPCs with
   `search_path` fixed to an empty value; `anon_execute=false`,
   `authenticated_execute=false`, and `service_role_execute=true` for each RPC;
   three triggers, a composite publication pointer from
   `(current_revision_id, clause_id)` to the same immutable revision, seven
   read policies, and five named indexes. Table grants and RLS policies are
   separate controls and both must remain present.

2. **Stage the bundled baseline without publishing.** First verify the import
   payload without a database connection, then run the idempotent import with
   an attorney/admin actor in the local or preview database:

   ```bash
   npm run clauses:import -- --dry-run
   ESTATE_CLAUSE_IMPORT_ACTOR_ID=<attorney-user-uuid> npm run clauses:import
   ```

   Expected: `bundled=22`, `requiresReview=22`, and `publications=0`. A repeat
   must not create duplicates or overwrite an attorney-modified working draft.

3. **Independently review.** Sign in to the clause-library UI as the importing
   attorney, correct any validation failures, and submit. Sign in as a distinct
   attorney/admin to preview and publish each approved revision. The author
   must not publish their own revision. Bundled clauses marked `draft` remain
   unpublished until their language receives affirmative attorney approval.

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
     'capturedFrom', 'local Supabase after independent attorney review',
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

5. **Verify in preview.** Run the focused suite documented in the implementation
   plan. Set `ESTATE_CLAUSE_SOURCE=database` only in a preview deployment, then
   generate and inspect representative Massachusetts Will, Trust, durable POA,
   Health Care Proxy/directive, and HIPAA packages. Confirm each included clause
   has one manifest row, skipped clauses have none, regeneration preserves the
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
npm run estate-generator:setup   # once, for Node/Python generators
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

## Part 5 — Twilio softphone (browser Voice + call logging)

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
