/*
  # Lock down calls_autoassign trigger helper

  calls_autoassign() is invoked by the calls table trigger and is not intended
  to be callable through PostgREST RPC by anonymous or signed-in users.
*/

REVOKE ALL ON FUNCTION public.calls_autoassign() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calls_autoassign() FROM anon;
REVOKE ALL ON FUNCTION public.calls_autoassign() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.calls_autoassign() TO service_role;
