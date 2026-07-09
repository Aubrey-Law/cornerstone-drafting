-- Atomic contact removal for matter/lead contact cards.

CREATE OR REPLACE FUNCTION public.delete_intake_contact(
  p_contact_id uuid,
  p_client_intake_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.contact_roles WHERE contact_id = p_contact_id;

  DELETE FROM public.contacts
  WHERE id = p_contact_id
    AND client_intake_id = p_client_intake_id;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_intake_contact(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_intake_contact(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
