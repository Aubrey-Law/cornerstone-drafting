/*
  # Fix v_matter_pipeline view — add CRM columns

  1. Modified Views
    - `v_matter_pipeline` — adds columns needed by the CRM leads query:
      - `practice_area` (from matter_details)
      - `referral_source` (from matter_details)
      - `fee_amount` (matter_details.flat_fee_amount)
      - `opened_at` (matter_details.open_date cast to timestamptz)

  2. Important Notes
    - The fetchLeads() query selects these columns from the view
    - Without them, the leads page fails to load after saving a lead
    - Uses CREATE OR REPLACE to safely update the view
*/

CREATE OR REPLACE VIEW public.v_matter_pipeline AS
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