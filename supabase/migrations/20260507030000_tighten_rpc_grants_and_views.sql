-- Tighten public-schema RPC surface area and SECURITY DEFINER views.
--
-- Two classes of issues, both surfaced by the Supabase security advisor:
--
-- 1. Default-grant antipattern. Postgres + Supabase grant EXECUTE to
--    PUBLIC/anon/authenticated on every newly created public function unless
--    explicitly revoked. The functions below are mutating, take caller-
--    chosen IDs as parameters, and have no internal auth.uid() check; all
--    callers in the application code use the service-role admin client.
--    Net: revoking PUBLIC/anon/authenticated removes a `/rest/v1/rpc/<fn>`
--    abuse vector while leaving server-side use intact.
--
--    `mark_messages_read` is the one exception: it is invoked client-side
--    from app/(portal)/messages/page.tsx with the user's JWT. It is NOT
--    SECURITY DEFINER, so it executes under the caller's RLS context and
--    cannot mutate rows the caller doesn't already own. Revoke from anon
--    only; keep authenticated.
--
-- 2. SECURITY DEFINER views. v_leads_pipeline and v_matter_pipeline ran as
--    their owner, bypassing RLS. v_matter_pipeline in particular is queried
--    from server-side code with the caller's auth context (lib/queries.ts:29
--    among others) and was therefore returning every matter to every
--    authenticated user, with cross-tenant filtering only by application-
--    level `.eq('client_email', userEmail)` calls. Underlying tables already
--    have correct client RLS (matters: client_id = auth.uid(); matter_details
--    / status_history scoped via matters; client_intake by user_id;
--    design_sheets by client_intake_id), and `is_attorney_or_staff()` opens
--    full access for staff. Switching the views to SECURITY INVOKER lets
--    that RLS do its job.

-- ── 1. Function grants ──────────────────────────────────────────────────────

DO $$
DECLARE
  fn_signature text;
  service_only_fns text[] := ARRAY[
    'public.append_review_note(uuid, jsonb)',
    'public.merge_li_design_sheet_data(uuid, jsonb)',
    'public.resolve_review_note(uuid, text, timestamptz)',
    'public.expire_folder_access()',
    'public.resolve_alert(uuid, uuid)',
    'public.check_stage_gates(uuid, text)',
    'public.get_folder_permission(uuid, uuid)',
    'public.has_folder_access(uuid, uuid)',
    'public.rls_auto_enable()'
  ];
BEGIN
  FOREACH fn_signature IN ARRAY service_only_fns LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn_signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn_signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn_signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn_signature);
  END LOOP;
END
$$;

-- mark_messages_read keeps authenticated EXECUTE (client UI calls it).
REVOKE ALL ON FUNCTION public.mark_messages_read(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_messages_read(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.mark_messages_read(uuid, text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.mark_messages_read(uuid, text) TO service_role;

-- ── 2. Pipeline views: SECURITY DEFINER → INVOKER ───────────────────────────

ALTER VIEW public.v_leads_pipeline  SET (security_invoker = true);
ALTER VIEW public.v_matter_pipeline SET (security_invoker = true);

COMMENT ON VIEW public.v_matter_pipeline IS
  'Matter+intake+design+details pipeline view. SECURITY INVOKER — RLS on the underlying tables determines visibility. Attorneys see all via is_attorney_or_staff(); clients see only their own matters via matters.client_id = auth.uid().';

COMMENT ON VIEW public.v_leads_pipeline IS
  'Active leads pipeline view. SECURITY INVOKER — leads RLS restricts to attorney/staff.';
