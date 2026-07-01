/*
  # Add spouse + address fields to v_matter_pipeline view

  The TypeScript `PipelineMatter` interface (types/database.ts) has long
  declared spouse_name/spouse_email/spouse_phone/spouse_dob/client_dob, but
  the underlying view never selected them — so the matter detail Contacts
  card never rendered the spouse, even for married clients.

  This migration drops/recreates the view to expose:
    - spouse_name (concatenated from spouse_first_name + spouse_last_name)
    - spouse_email, spouse_phone, spouse_dob
    - client_dob
    - client_address (single formatted string, NULLs squeezed)
    - spouse_address (same as client_address — couples share an address;
      no separate spouse address column exists in client_intake)

  Note on plan_type: legacy stored values ("Estate Planning",
  "Estate Planning | LP") are now coerced to "N/A" in the UI by
  normalizePlanType. A backfill of the column is intentionally deferred
  until Scott confirms historical Will vs Trust classification.
*/

-- CASCADE drops the dependent client_read_visible_matter_documents policy;
-- it is recreated below immediately after the view.
DROP VIEW IF EXISTS public.v_matter_pipeline CASCADE;
CREATE VIEW public.v_matter_pipeline AS
SELECT
  m.id            AS matter_id,
  m.name          AS matter_name,
  m.stage,
  m.status,
  m.flags,
  m.created_at    AS matter_created,
  (ci.first_name || ' ' || ci.last_name) AS client_name,
  ci.email        AS client_email,
  ci.phone        AS client_phone,
  ci.date_of_birth AS client_dob,
  NULLIF(
    concat_ws(', ',
      NULLIF(trim(concat_ws(' ',
        NULLIF(ci.address_line1, ''),
        NULLIF(ci.address_line2, '')
      )), ''),
      NULLIF(ci.city, ''),
      NULLIF(
        trim(concat_ws(' ',
          NULLIF(ci.state, ''),
          NULLIF(ci.zip, '')
        )),
        ''
      )
    ),
    ''
  )               AS client_address,
  NULLIF(trim(coalesce(ci.spouse_first_name, '') || ' ' || coalesce(ci.spouse_last_name, '')), '')
                  AS spouse_name,
  ci.spouse_email AS spouse_email,
  ci.spouse_phone AS spouse_phone,
  ci.spouse_date_of_birth AS spouse_dob,
  -- couples share an address; expose the same formatted string for the
  -- spouse contact card so callers don't need conditional logic
  NULLIF(
    concat_ws(', ',
      NULLIF(trim(concat_ws(' ',
        NULLIF(ci.address_line1, ''),
        NULLIF(ci.address_line2, '')
      )), ''),
      NULLIF(ci.city, ''),
      NULLIF(
        trim(concat_ws(' ',
          NULLIF(ci.state, ''),
          NULLIF(ci.zip, '')
        )),
        ''
      )
    ),
    ''
  )               AS spouse_address,
  ci.plan_type,
  ci.marital_status,
  ci.has_minor_children,
  ci.taxable_estate,
  ci.status       AS intake_status,
  ci.intake_sent_at,
  ds.status       AS design_status,
  m.intake_submitted_at,
  m.drafts_sent_at,
  m.signing_date,
  m.documents_executed_at,
  a.next_appointment,
  a.next_appointment_type,
  md.practice_area,
  md.referral_source,
  md.flat_fee_amount AS fee_amount,
  md.open_date::timestamptz AS opened_at
FROM matters m
JOIN client_intake ci ON ci.id = m.client_intake_id
LEFT JOIN design_sheets ds ON ds.matter_id = m.id
LEFT JOIN matter_details md ON md.client_id = m.id
LEFT JOIN LATERAL (
  SELECT
    appointments.scheduled_at AS next_appointment,
    appointments.type         AS next_appointment_type
  FROM appointments
  WHERE appointments.matter_id = m.id
    AND appointments.status = ANY (ARRAY['scheduled','confirmed'])
    AND appointments.scheduled_at > now()
  ORDER BY appointments.scheduled_at
  LIMIT 1
) a ON true
WHERE m.status <> 'archived';

-- Recreate the RLS policy dropped by CASCADE above.
CREATE POLICY "client_read_visible_matter_documents"
  ON matter_documents
  FOR SELECT
  TO authenticated
  USING (
    lower(coalesce(folder, '')) NOT IN ('draft', 'drafts')
    AND (
      folder_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM folders f
        WHERE f.id = matter_documents.folder_id
          AND lower(f.name) IN ('draft', 'drafts')
      )
    )
    AND (
      EXISTS (
        SELECT 1 FROM matters m
        WHERE m.id::text = matter_documents.matter_id
          AND m.client_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM v_matter_pipeline v
        WHERE v.matter_id::text = matter_documents.matter_id
          AND v.client_email = (
            SELECT email FROM auth.users WHERE id = auth.uid()
          )
      )
    )
  );
