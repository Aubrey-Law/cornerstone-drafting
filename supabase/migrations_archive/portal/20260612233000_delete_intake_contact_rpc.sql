-- Atomic contact removal for lead/matter contact cards.
--
-- The admin "remove contact" routes need to clear a contact's fiduciary role
-- assignments and then delete the contact itself. Doing that as two separate
-- statements is not atomic: if the contact delete fails after the role delete
-- succeeds (another FK, a transient error), the roles are gone but the contact
-- remains, silently corrupting the matter/lead design data. Wrapping both
-- deletes in a plpgsql function runs them in a single transaction so they
-- either both apply or both roll back.

CREATE OR REPLACE FUNCTION public.delete_intake_contact(
  p_contact_id uuid,
  p_client_intake_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  -- Clear fiduciary role assignments first so the contact delete can't trip a
  -- foreign key. Both statements share this function's single transaction.
  DELETE FROM public.contact_roles WHERE contact_id = p_contact_id;

  DELETE FROM public.contacts
  WHERE id = p_contact_id
    AND client_intake_id = p_client_intake_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_intake_contact(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_intake_contact(uuid, uuid) TO service_role;
