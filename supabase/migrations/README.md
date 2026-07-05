# Drafting-only migrations

This app ships a **minimal Supabase schema** for estate-planning document drafting.

| Migration | Purpose |
|-----------|---------|
| `20260705000000_drafting_baseline_core.sql` | Users, matters, intake, contacts, design sheets, doc selections |
| `20260705000001_drafting_baseline_documents.sql` | Documents, folders, audit log, matter details |
| `20260705000002_drafting_baseline_pipeline.sql` | Pipeline view, activity, AI usage, RLS, auth hook |

The full CRM portal history (167 files) lives in [`../migrations_archive/portal/`](../migrations_archive/portal/README.md).

## Fresh local database

```bash
supabase start
supabase db reset   # applies only the drafting baseline
```

## Shared firm database

Production and staging typically already have the portal schema. **Do not** archive-reset those projects — deploy app code only.

## Storage

Create a Supabase Storage bucket named `templates` with DOCX estate-plan templates (used by the Supabase template engine fallback). Document bytes live in Cloudflare R2, not Supabase Storage.
