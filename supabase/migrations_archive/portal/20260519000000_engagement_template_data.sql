-- Persist the structured inputs used to render the engagement-agreement
-- Word template. The 'send' and 'add_to_matter' actions re-render the DOCX
-- from these inputs so output is reproducible without the UI re-supplying
-- the flags (couple, trust_plan, legal_plan, credit_shelter, etc.).

ALTER TABLE public.engagement_agreements
  ADD COLUMN IF NOT EXISTS template_data jsonb;
