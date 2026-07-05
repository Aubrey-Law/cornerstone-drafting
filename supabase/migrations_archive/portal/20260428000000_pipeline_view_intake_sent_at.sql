/*
  # Add intake_sent_at to v_matter_pipeline view

  The leads pipeline UI needs to know whether the intake form has been sent
  to a client so cards can show a "Send Intake" link only when needed.
  `intake_sent_at` lives on `client_intake`; we surface it via the existing
  pipeline view rather than adding a separate query in fetchLeads.
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
