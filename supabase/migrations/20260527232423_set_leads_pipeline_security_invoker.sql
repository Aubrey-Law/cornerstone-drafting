-- v_leads_pipeline was recreated by 20260510000000. Reassert security_invoker
-- so reads observe the underlying RLS policies instead of the view owner's
-- privileges.

ALTER VIEW public.v_leads_pipeline
  SET (security_invoker = true);
