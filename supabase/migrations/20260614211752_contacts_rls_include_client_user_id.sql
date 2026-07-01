/*
  # Align contacts / contact_roles client RLS with client_intake (include client_user_id)

  The client RLS policies on contacts and contact_roles scoped a household by
  client_intake.user_id ONLY:

    client_intake_id IN (SELECT id FROM client_intake WHERE user_id = auth.uid())

  But client_intake's own policies grant access via user_id OR client_user_id,
  and invited portal clients are linked via client_user_id (see the app's
  ownedOrClause in app/api/intake/contacts/route.ts). As written, an invited
  client doing a direct table read of contacts/contact_roles gets nothing — a
  latent correctness bug. This is OVER-restrictive, never a leak: there is no
  path to another household (the IN-subquery still pins to the caller's own
  client_intake rows, and these ALL policies reuse USING as WITH CHECK so
  inserts/moves are likewise constrained).

  Live client contact writes currently go through the admin-client route, which
  already verifies ownership against both columns; this change is defense-in-depth
  and fixes any future client-side direct access.

  Apply via `apply_migration` (records cleanly) — do NOT blind `db push`
  (diverged history).
*/

ALTER POLICY "Clients can manage own contacts" ON public.contacts
  USING (
    client_intake_id IN (
      SELECT id FROM public.client_intake
      WHERE user_id = auth.uid() OR client_user_id = auth.uid()
    )
  );

ALTER POLICY "Clients can manage own contact roles" ON public.contact_roles
  USING (
    client_intake_id IN (
      SELECT id FROM public.client_intake
      WHERE user_id = auth.uid() OR client_user_id = auth.uid()
    )
  );
