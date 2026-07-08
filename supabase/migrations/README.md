# Drafting-only migrations

This app ships a **minimal Supabase schema** for estate-planning document drafting.

| Migration | Purpose |
|-----------|---------|
| `20260705000000_drafting_baseline_core.sql` | Users, matters, intake, contacts, design sheets, doc selections |
| `20260705000001_drafting_baseline_documents.sql` | Documents, folders, audit log, matter details |
| `20260705000002_drafting_baseline_pipeline.sql` | Pipeline view, activity, AI usage, RLS, auth hook |
| `20260705000003_user_preferences.sql` | `users.preferences` jsonb for per-staff UI settings |
| `20260708000000_document_versions_edits_tabular.sql` | `document_versions`, `document_edits`, tabular review tables, audit action extensions |
| `20260708000001_user_api_keys_mcp_connectors.sql` | Staff BYOK API keys + MCP connector storage (service-role only) |
| `20260708120000_matter_assistant_messages.sql` | Persisted matter-scoped drafting assistant chat history |

The full CRM portal history (167 files) lives in [`../migrations_archive/portal/`](../migrations_archive/portal/README.md).

## Fresh local database

```bash
supabase start
supabase db reset   # applies only the drafting baseline
```

## Shared firm database

Production and staging typically already have the portal schema. **Do not** archive-reset those projects — deploy app code only.

**Do not run `supabase db push`** against the shared firm project. The remote database records ~167 portal migrations that are archived locally; the CLI will refuse to push and suggest `migration repair`, which you should not run unless you fully understand the consequences.

To apply new incremental migrations (e.g. versions + settings):

1. Open **Supabase Dashboard → SQL Editor** for the firm project.
2. Run each file in order (safe to re-run — uses `IF NOT EXISTS`):
   - `20260708000000_document_versions_edits_tabular.sql`
   - `20260708000001_user_api_keys_mcp_connectors.sql`
   - `20260708120000_matter_assistant_messages.sql`
3. Optionally record them in the migration history table:

```sql
INSERT INTO supabase_migrations.schema_migrations (version)
VALUES ('20260708000000'), ('20260708000001'), ('20260708120000')
ON CONFLICT DO NOTHING;
```

Also set `USER_API_KEYS_ENCRYPTION_SECRET` (and optionally `DOCX_PDF_CONVERT_URL` / `DOCX_PDF_CONVERT_SECRET`) in Vercel before using Settings → API Keys or Convert PDF.

## Storage

Create a Supabase Storage bucket named `templates` with DOCX estate-plan templates (used by the Supabase template engine fallback). Document bytes live in Cloudflare R2, not Supabase Storage.
