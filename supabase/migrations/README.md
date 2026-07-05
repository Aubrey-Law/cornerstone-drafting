# Drafting-only migrations

This app ships a **minimal Supabase schema** for estate-planning document drafting.

| Migration | Purpose |
|-----------|---------|
| `20260705000000_drafting_baseline_core.sql` | Users, matters, intake, contacts, design sheets, doc selections |
| `20260705000001_drafting_baseline_documents.sql` | Documents, folders, audit log, matter details |
| `20260705000002_drafting_baseline_pipeline.sql` | Pipeline view, activity, AI usage, RLS, auth hook |
| `20260705000003_user_preferences.sql` | `users.preferences` jsonb for per-staff UI settings |

The full CRM portal history (167 files) lives in [`../migrations_archive/portal/`](../migrations_archive/portal/README.md).

## Fresh local database

```bash
supabase start
supabase db reset   # applies only the drafting baseline
```

## Shared firm database

Production and staging typically already have the portal schema. **Do not** archive-reset those projects — deploy app code only.

**Do not run `supabase db push`** against the shared firm project. The remote database records ~167 portal migrations that are archived locally; the CLI will refuse to push and suggest `migration repair`, which you should not run unless you fully understand the consequences.

To apply a new incremental migration (e.g. `20260705000003_user_preferences.sql`):

1. Open **Supabase Dashboard → SQL Editor** for the firm project.
2. Run the migration file contents (safe to re-run — uses `IF NOT EXISTS`):

```sql
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.users.preferences IS
  'Staff UI preferences keyed by app area, e.g. {"drafting":{"designView":"guided"}}';
```

3. Optionally record it in the migration history table so local tooling stays aware:

```sql
INSERT INTO supabase_migrations.schema_migrations (version)
VALUES ('20260705000003')
ON CONFLICT DO NOTHING;
```

The app works without this column — design view preference falls back to `localStorage` until the SQL is applied.

## Storage

Create a Supabase Storage bucket named `templates` with DOCX estate-plan templates (used by the Supabase template engine fallback). Document bytes live in Cloudflare R2, not Supabase Storage.
