/*
  # Backfill contact_roles from client_intake.fiduciary_entries JSONB

  One-time backfill for F1 of the fiduciary-roles unification work.
  See docs/superpowers/specs/2026-06-15-fiduciary-roles-unification-F1-design.md.

  Walks every client_intake with non-null fiduciary_entries JSONB, parses the
  slot/array shape into role/for_party/priority triples, and inserts into
  contact_roles. Idempotent: ON CONFLICT DO NOTHING on the natural key.

  Apply via Supabase MCP `apply_migration` (not `db push` — diverged history).
  After applying, rename this file to the recorded version per the
  migration-history-reconcile pattern.

  Roles handled: personal_rep, trustee, poa, hcp, guardian
  Parties handled: client, spouse
  Priorities handled: 1 (primary) and 2 (alternate)
  Co-agents (is_coagent=true) and higher priorities are NOT backfilled —
  they will be wiped + re-inserted on the next intake save anyway.
*/

DO $$
DECLARE
  intake_id      uuid;
  entries        jsonb;
  slot_key       text;
  slot_role      text;
  slot_party     text;
  slot_arr       jsonb;
  entry          jsonb;
  idx            int;
  prio           int;
  v_first_name   text;
  v_last_name    text;
  email_val      text;
  phone_val      text;
  contact_id_val uuid;
BEGIN
  FOR intake_id, entries IN
    SELECT id, fiduciary_entries
    FROM public.client_intake
    WHERE fiduciary_entries IS NOT NULL
      AND jsonb_typeof(fiduciary_entries) = 'object'
  LOOP
    FOR slot_key, slot_arr IN
      SELECT key, value FROM jsonb_each(entries)
    LOOP
      -- Decode slot_key -> (role, for_party). Skip unknown keys.
      CASE slot_key
        WHEN 'fid_personal_rep_client' THEN slot_role := 'personal_rep'; slot_party := 'client';
        WHEN 'fid_personal_rep_spouse' THEN slot_role := 'personal_rep'; slot_party := 'spouse';
        WHEN 'fid_trustee_client'      THEN slot_role := 'trustee';      slot_party := 'client';
        WHEN 'fid_trustee_spouse'      THEN slot_role := 'trustee';      slot_party := 'spouse';
        WHEN 'fid_poa_client'          THEN slot_role := 'poa';          slot_party := 'client';
        WHEN 'fid_poa_spouse'          THEN slot_role := 'poa';          slot_party := 'spouse';
        WHEN 'fid_hcp_client'          THEN slot_role := 'hcp';          slot_party := 'client';
        WHEN 'fid_hcp_spouse'          THEN slot_role := 'hcp';          slot_party := 'spouse';
        WHEN 'fid_guardian_client'     THEN slot_role := 'guardian';     slot_party := 'client';
        ELSE CONTINUE;
      END CASE;

      IF jsonb_typeof(slot_arr) <> 'array' THEN CONTINUE; END IF;

      idx := 0;
      FOR entry IN SELECT value FROM jsonb_array_elements(slot_arr)
      LOOP
        prio := idx + 1;
        idx := idx + 1;
        IF prio > 2 THEN CONTINUE; END IF;  -- F1 only handles primary + alternate
        IF jsonb_typeof(entry) <> 'object' THEN CONTINUE; END IF;

        v_first_name := NULLIF(TRIM(entry ->> 'first_name'), '');
        v_last_name  := NULLIF(TRIM(entry ->> 'last_name'),  '');
        IF v_first_name IS NULL AND v_last_name IS NULL THEN CONTINUE; END IF;

        email_val := NULLIF(TRIM(entry ->> 'email'), '');
        phone_val := NULLIF(TRIM(entry ->> 'phone'), '');

        -- Reuse existing contact for this intake by (first, last) case-insensitive.
        SELECT c.id INTO contact_id_val
        FROM public.contacts c
        WHERE c.client_intake_id = intake_id
          AND LOWER(COALESCE(c.first_name, '')) = LOWER(COALESCE(v_first_name, ''))
          AND LOWER(COALESCE(c.last_name,  '')) = LOWER(COALESCE(v_last_name,  ''))
        LIMIT 1;

        IF contact_id_val IS NULL THEN
          INSERT INTO public.contacts (
            client_intake_id, relationship_type, first_name, last_name,
            email, phone, source
          )
          VALUES (
            intake_id, 'other', v_first_name, v_last_name,
            email_val, phone_val, 'client'
          )
          RETURNING id INTO contact_id_val;
        END IF;

        INSERT INTO public.contact_roles (
          client_intake_id, contact_id, role, for_party, priority, is_coagent
        )
        VALUES (
          intake_id, contact_id_val, slot_role, slot_party, prio, false
        )
        ON CONFLICT DO NOTHING;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;
