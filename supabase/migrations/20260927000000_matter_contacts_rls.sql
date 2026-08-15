-- Step 4 (part) of docs/matter-contacts-migration.md: move the contact
-- authorization boundary onto the join, and make removing a person from a
-- matter mean removing them from *that* matter.
--
-- Step 3 flipped every contact read onto `matter_contacts`. Two things were
-- still keyed on the household:
--
--   1. The portal's RLS policies, which traverse
--      `contacts.client_intake_id -> client_intake -> auth.uid()`. That column
--      is write-only now and is dropped in step 7, at which point the policies
--      would silently match nothing — RLS failing closed is better than failing
--      open, but it would take the client portal's fiduciary picker with it.
--   2. `delete_intake_contact`, which deletes the person outright. Once a
--      person is on two matters, removing them from one would delete them from
--      both.
--
-- The §5 single-row lookups (matters resolved from an intake) are deliberately
-- NOT in here: whether they are wrong at all depends on the open decision in
-- §12 about whether a second engagement reuses its client's intake or gets its
-- own. Under "new intake per engagement" they stay correct; under a shared
-- intake every one of them needs a matter threaded through. Guessing would
-- mean rewriting them twice.

-- ── contacts ────────────────────────────────────────────────────────────────
--
-- Narrowed from FOR ALL to SELECT. The portal has exactly one client-side
-- reader (components/intake/FiduciaryContactPicker.tsx, on the anon key) and no
-- client-side writer — every portal write goes through a service-role route,
-- which bypasses RLS entirely. A policy granting INSERT/UPDATE/DELETE to
-- `authenticated` was therefore permitting more than anything used.
--
-- FOR ALL would also have been unusable here: its WITH CHECK runs against the
-- row being inserted, and a brand-new contact has no join row yet — the step 2
-- trigger creates it immediately after. Every portal contact insert would fail
-- the check.

drop policy if exists "clients_manage_own_contacts" on public.contacts;
drop policy if exists "clients_read_own_contacts" on public.contacts;

create policy "clients_read_own_contacts"
  on public.contacts for select to authenticated
  using (
    exists (
      select 1
      from public.matter_contacts mc
      join public.matters m on m.id = mc.matter_id
      join public.client_intake ci on ci.id = m.client_intake_id
      where mc.contact_id = contacts.id
        and (ci.user_id = auth.uid() or ci.client_user_id = auth.uid())
    )
  );

comment on policy "clients_read_own_contacts" on public.contacts is
  'A portal client sees the people on their matters. A person shared between two '
  'matters is visible to both clients — that is the point of the join, and is what '
  'lets a parent and child share one record. Standalone directory contacts belong '
  'to no matter and stay invisible to every portal user.';

-- ── contact_roles ───────────────────────────────────────────────────────────
--
-- Keyed on the appointment's matter rather than on its contact's household, so
-- a second engagement's fiduciaries are not visible from the first.

drop policy if exists "clients_manage_own_contact_roles" on public.contact_roles;
drop policy if exists "clients_read_own_contact_roles" on public.contact_roles;

create policy "clients_read_own_contact_roles"
  on public.contact_roles for select to authenticated
  using (
    exists (
      select 1
      from public.matters m
      join public.client_intake ci on ci.id = m.client_intake_id
      where m.id = contact_roles.matter_id
        and (ci.user_id = auth.uid() or ci.client_user_id = auth.uid())
    )
  );

-- ── Removing a person from a matter ─────────────────────────────────────────
--
-- `delete_intake_contact(contact, intake)` deleted the person and every role
-- they held. With one person on several matters that is far too broad: removing
-- a trustee from the 2026 engagement would erase them from the 2024 one too.
--
-- The replacement detaches from the named matter, drops only that matter's
-- roles, and deletes the person themself only once no matter references them.
-- The old function stays until step 7 so a deploy that races this migration
-- keeps working.

create or replace function public.delete_matter_contact(
  p_contact_id uuid,
  p_matter_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  detached_count integer;
  remaining_count integer;
BEGIN
  -- Appointments belong to the matter, so only this matter's are cleared.
  DELETE FROM public.contact_roles
  WHERE contact_id = p_contact_id
    AND matter_id = p_matter_id;

  DELETE FROM public.matter_contacts
  WHERE contact_id = p_contact_id
    AND matter_id = p_matter_id;

  GET DIAGNOSTICS detached_count = ROW_COUNT;
  IF detached_count = 0 THEN
    RETURN 0;
  END IF;

  SELECT count(*) INTO remaining_count
  FROM public.matter_contacts
  WHERE contact_id = p_contact_id;

  -- Still on another matter: the person stays, they are simply no longer on
  -- this one. Only a person left on no matter at all is deleted, and then only
  -- if they are not a standalone directory entry.
  IF remaining_count = 0 THEN
    DELETE FROM public.contact_roles WHERE contact_id = p_contact_id;
    DELETE FROM public.contacts
    WHERE id = p_contact_id
      AND client_intake_id IS NOT NULL;
  END IF;

  RETURN detached_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_matter_contact(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_matter_contact(uuid, uuid) TO service_role;

comment on function public.delete_matter_contact(uuid, uuid) is
  'Remove a person from one matter. Deletes the contacts row only when no matter '
  'still references them. Replaces delete_intake_contact, which deleted the person '
  'outright and so would have removed them from every matter at once.';

notify pgrst, 'reload schema';
