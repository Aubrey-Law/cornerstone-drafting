# Supabase migrations

Cornerstone Lite uses a **greenfield Supabase project** with two migration layers:

1. **Drafting baseline** — creates core tables (`client_intake`, `matters`, `contacts`, documents, pipeline, etc.)
2. **Lite extensions** — adds portal intake columns, messages, aging, and communications

**All migrations must run in timestamp order.** Lite files only `ALTER` or extend tables from the baseline; they do not create `client_intake`.

## Full migration order (greenfield)

| # | File | Purpose |
|---|------|---------|
| 1 | `20260705000000_drafting_baseline_core.sql` | Users, matters, **client_intake**, contacts, design sheets |
| 2 | `20260705000001_drafting_baseline_documents.sql` | Documents, folders, audit log, matter details |
| 3 | `20260705000002_drafting_baseline_pipeline.sql` | Pipeline view, activity, AI usage, RLS, auth hook |
| 4 | `20260705000003_user_preferences.sql` | `users.preferences` jsonb |
| 5 | `20260708000000_document_versions_edits_tabular.sql` | Document versions, edits, tabular review |
| 6 | `20260708000001_user_api_keys_mcp_connectors.sql` | Staff API keys + MCP connectors |
| 7 | `20260708120000_matter_assistant_messages.sql` | Matter-scoped drafting assistant chat |
| 8 | `20260710000000_lite_intake_portal.sql` | Lite intake columns + client document upload RLS |
| 9 | `20260710500000_lite_portal_messages.sql` | Portal message threads |
| 10 | `20260711000000_lite_matter_aging.sql` | Matter aging view + SLA settings |
| 11 | `20260712000000_lite_communications.sql` | SMS, email, calls, softphone, Retell |
| 12 | `20260713000000_lite_matter_details_columns.sql` | `matter_details` columns for matter create + setup |
| 13 | `20260714000000_lite_intake_invite_tokens.sql` | Hashed intake invite tokens for client signup |
| 14 | `20260715000000_lite_design_sheets_intake_columns.sql` | Design sheet intake/editable columns + `contacts.is_minor` |
| 15 | `20260716000000_lite_full_intake_columns.sql` | Full intake questionnaire columns, documents, fiduciary roles |
| 16 | `20260717000000_drafting_hub_draft_rollups.sql` | Hub draft count/recent rollups RPC |
| 17 | `20260718000000_lite_messages_realtime.sql` | Realtime publication for portal `messages` |
| 18 | `20260719000000_lite_email_settings.sql` | Firm settings, email templates, email_settings provider |

The archived CRM portal history (167 files) lives in [`../migrations_archive/portal/`](../migrations_archive/portal/README.md).

## Greenfield Supabase project (recommended)

Use a **new** Supabase project for Cornerstone Lite — not the live Aubrey Law firm database.

### Option A — Supabase CLI (easiest)

```bash
# Link your greenfield project (one-time)
npx supabase link --project-ref <your-project-ref>

# Apply all 18 migrations in order
npx supabase db push
```

### Option B — SQL Editor

If you paste migrations manually in the dashboard, run **every file above in order** (1 → 16). Do not start with `20260710000000_lite_intake_portal.sql`.

### Option C — Local dev

```bash
supabase start
supabase db reset   # applies all migrations + supabase/seed.sql
```

After reset, `seed.sql` grants table privileges and adds a few columns the app expects locally.

## First login (greenfield)

Auth users live in `auth.users`; the app also needs a row in `public.users` with a `role`.

**OAuth (Google / Microsoft):** The callback auto-creates `public.users` on first sign-in.

**Email / password:** Create the user in **Supabase Dashboard → Authentication → Users → Add user**, then either:

- Sign in once (the app auto-creates `public.users` on password login), or
- Insert manually:

```sql
INSERT INTO public.users (id, email, role, display_name)
VALUES (
  '<auth-user-uuid>',
  'you@aubreylegal.com',
  'attorney',
  'Your Name'
);
```

Staff admin routes require `role` in (`attorney`, `admin`). OAuth staff sign-in also requires an `@aubreylegal.com` email.

**Optional — JWT role claim:** Enable **Authentication → Hooks → Custom Access Token Hook** → `public.custom_access_token_hook` so `proxy.ts` can read `user_role` from the token without a DB query on every request.

## Common error: `relation "public.client_intake" does not exist`

This means the **drafting baseline** (migrations 1–7) has not been applied yet. `20260710000000_lite_intake_portal.sql` begins with:

```sql
ALTER TABLE public.client_intake ...
```

`client_intake` is created in `20260705000000_drafting_baseline_core.sql`. Fix:

1. Run migrations 1–7 first (or use `supabase db push` / `supabase db reset` on a greenfield project).
2. Then run lite migrations 8–16.

## Common error: `jurisdiction_state` / `plan_type` on `matter_details`

Matter create writes extra columns on `matter_details` that the minimal drafting baseline does not include. You need migration **#12**:

`20260713000000_lite_matter_details_columns.sql`

**Do not run the backfill `INSERT` until after the `ALTER TABLE` adds the columns.**

Quick fix (Supabase SQL Editor) — paste the full script:

[`../scripts/fix_matter_details_columns.sql`](../scripts/fix_matter_details_columns.sql)

Or CLI after `git pull`:

```bash
npx supabase db push
```

Verify columns exist:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'matter_details'
  AND column_name IN ('jurisdiction_state', 'plan_type', 'matter_status', 'matter_number');
```

You should see all four rows.

## Common error: `intake_token_expires_at` on Send Intake

Client invite links need migration **#13**:

`20260714000000_lite_intake_invite_tokens.sql`

Quick fix — paste [`../scripts/fix_intake_invite_tokens.sql`](../scripts/fix_intake_invite_tokens.sql) in the SQL Editor, or:

```bash
git pull
npx supabase db push
```

Verify:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'client_intake'
  AND column_name IN ('intake_token_hash', 'intake_token_expires_at');
```

## Common error: drafting workspace / design sheet after intake submit

Intake can succeed while drafting still fails on open if the greenfield DB is missing columns the workspace loader reads. Apply migration **#14**:

`20260715000000_lite_design_sheets_intake_columns.sql`

Quick fix — paste [`../scripts/fix_design_sheets_intake_columns.sql`](../scripts/fix_design_sheets_intake_columns.sql) in the SQL Editor, or:

```bash
git pull
npx supabase db push
```

Verify:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'design_sheets'
  AND column_name IN ('client_name', 'client_pronouns', 'trustee_primary');

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'contacts'
  AND column_name = 'is_minor';
```

After the migration, reload `/admin/drafting/[matterId]` — the app re-seeds the design sheet from intake on first open.

## Shared firm database (do not use for Lite)

Production and staging for the **full** Aubrey Law portal already have the archived portal schema. **Do not** reset or `db push` against that project from this repo — the CLI will conflict with ~167 archived remote migrations.

For incremental updates on the firm DB only, run specific SQL files manually in the dashboard (see git history for this README’s firm-DB section if needed).

## Storage

Create a Supabase Storage bucket named `templates` with DOCX estate-plan templates (Supabase template engine fallback). Document bytes live in Cloudflare R2, not Supabase Storage.
