-- Local development grants applied after the canonical migrations.
-- Auto-runs after migrations on `supabase db reset` (and on the first
-- `supabase start`). Safe/idempotent to re-run. NOT used by the hosted firm DB.
--
-- The local Supabase stack's default privileges omit
--     SELECT/INSERT/UPDATE for anon/authenticated on `public` tables. The
--     drafting migrations rely on those grants (RLS controls the rows), so
--     without them the users-role lookup in proxy.ts returns null and login
--     ends in an /auth/login <-> /admin/drafting redirect loop.
-- Schema belongs in timestamped migrations, not in this seed file.
--
-- ── Why the exception lists below exist ──────────────────────────────────────
-- This file used to end at the blanket grants, which made a local database
-- MORE permissive than production on exactly the tables that matter most:
-- `user_api_keys` and `user_mcp_oauth_tokens` hold credentials and have no
-- anon/authenticated grants at all in production, but a blanket
-- `GRANT ... ON ALL TABLES TO authenticated` handed local ones
-- SELECT/INSERT/UPDATE/DELETE. Anyone rehearsing an RLS or PostgREST change
-- locally was testing against a weaker permission model than the real one.
--
-- Production's shape (audited 2026-08-11 against qifunlovuwaryzsyfbnh) is
-- Supabase's one-time setup grant — ALL privileges to anon and authenticated —
-- with three groups of tables left out of it. Those omissions are incidental
-- rather than designed: none of them has an explicit GRANT or REVOKE in any
-- migration. They are simply the tables created after the setup grant ran, so
-- they never received it. Reproduced here anyway, because the point of the
-- local stack is to rehearse production, and reproducing it faithfully is what
-- makes a permissions regression show up locally instead of in the firm's DB.
--
-- RLS is enabled on every table in both databases and no policy is satisfiable
-- by anon (each one requires auth.uid() to resolve to a staff row in
-- public.users), so none of this is load-bearing on its own — it is the second
-- layer, kept honest.
--
-- To re-audit after adding tables, compare this against production:
--   select c.relname,
--     (select string_agg(distinct a.privilege_type, ',' order by a.privilege_type)
--        from aclexplode(c.relacl) a where a.grantee = 'anon'::regrole::oid)
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public' and c.relkind = 'r' order by 1;

-- ── Baseline (matches hosted Supabase platform defaults) ─────────────────────
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
-- Function privileges are intentionally defined by migrations. A blanket
-- grant here would undo explicit RPC hardening and expose service-only calls.

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- ── Exception 1: reachable only through service_role ─────────────────────────
-- Credential stores, webhook receipts, the Box export queue and the template
-- publication ledger. No anon or authenticated grant in production.
REVOKE ALL ON TABLE
  public.box_document_exports,
  public.box_matter_folders,
  public.document_template_events,
  public.document_template_publications,
  public.document_template_versions,
  public.intake_invite_audit,
  public.intake_form_audit_events,
  public.intake_form_templates,
  public.intake_form_versions,
  public.integration_entity_leases,
  public.integration_external_records,
  public.integration_settings,
  public.telephony_webhook_events,
  public.user_api_keys,
  public.user_mcp_connectors,
  public.user_mcp_oauth_tokens
FROM anon, authenticated;

-- The form lifecycle guards protect UPDATE/DELETE, so service_role must not
-- retain blanket TRUNCATE/TRIGGER privileges that could bypass those guards.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.intake_form_templates,
  public.intake_form_versions
FROM service_role;

-- Audit events stay append-only after the local baseline grants above.
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.intake_form_audit_events
FROM service_role;

-- ── Exception 2: authenticated may read, never write ─────────────────────────
-- The estate clause library and its review trail. Writes go through the
-- publication RPCs, which enforce their own review workflow.
REVOKE ALL ON TABLE
  public.estate_clause_preview_evidence,
  public.estate_clause_publications,
  public.estate_clause_review_events,
  public.estate_clause_revisions,
  public.estate_clause_working_drafts,
  public.estate_clauses,
  public.firm_holidays,
  public.generated_document_clause_revisions,
  public.matter_estate_clause_overrides
FROM anon, authenticated;

GRANT SELECT ON TABLE
  public.estate_clause_preview_evidence,
  public.estate_clause_publications,
  public.estate_clause_review_events,
  public.estate_clause_revisions,
  public.estate_clause_working_drafts,
  public.estate_clauses,
  public.firm_holidays,
  public.generated_document_clause_revisions,
  public.matter_estate_clause_overrides
TO authenticated;

-- ── Exception 3: ledger rows are written by RPC only ─────────────────────────
-- authenticated keeps SELECT; money moves through create_billing_item,
-- record_billing_payment and mark_billing_item_invoiced.
REVOKE DELETE, INSERT, UPDATE ON TABLE
  public.billing_events,
  public.billing_items,
  public.billing_payments
FROM authenticated;
