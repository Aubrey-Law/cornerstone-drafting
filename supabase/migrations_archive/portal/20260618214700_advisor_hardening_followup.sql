-- Reassert Supabase advisor hardening after later migrations recreated views
-- and functions without the desired security attributes.

ALTER VIEW public.v_leads_pipeline SET (security_invoker = true);
ALTER VIEW public.v_matter_pipeline SET (security_invoker = true);

ALTER FUNCTION public.set_lead_task_templates_updated_at() SET search_path = public;
ALTER FUNCTION public.rate_limit_consume(text, text, integer) SET search_path = public;
ALTER FUNCTION public.rate_limit_gc(integer) SET search_path = public;
ALTER FUNCTION public.normalize_us_phone(text) SET search_path = public;

REVOKE ALL ON FUNCTION public.delete_intake_contact(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_intake_contact(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.delete_intake_contact(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_intake_contact(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.sync_campaign_lead_counts(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_campaign_lead_counts(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.sync_campaign_lead_counts(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sync_campaign_lead_counts(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.trg_leads_sync_campaign_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_leads_sync_campaign_counts() FROM anon;
REVOKE ALL ON FUNCTION public.trg_leads_sync_campaign_counts() FROM authenticated;

REVOKE ALL ON FUNCTION public.triage_match_sender(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.triage_match_sender(text) FROM anon;
REVOKE ALL ON FUNCTION public.triage_match_sender(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.triage_match_sender(text) TO service_role;

REVOKE ALL ON FUNCTION public.get_recent_auth_events(integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_recent_auth_events(integer, text) FROM anon;
REVOKE ALL ON FUNCTION public.get_recent_auth_events(integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_auth_events(integer, text) TO service_role;
