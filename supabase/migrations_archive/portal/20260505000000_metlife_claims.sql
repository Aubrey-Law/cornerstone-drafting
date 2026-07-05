-- MetLife Legal Plan reimbursement claims.
-- Adds plan-type + service-window fields to matter_details and creates
-- metlife_claims to track each generated claim guide.

ALTER TABLE public.matter_details
  ADD COLUMN IF NOT EXISTS legal_plan_type text,
  ADD COLUMN IF NOT EXISTS legal_plan_service_start date,
  ADD COLUMN IF NOT EXISTS legal_plan_service_end date;

COMMENT ON COLUMN public.matter_details.legal_plan_type IS
  'MetLife plan composition: separate_trust | joint_trust | will_couple | will_individual | individual_trust';
COMMENT ON COLUMN public.matter_details.legal_plan_service_start IS
  'First date of legal-plan billable work (used by MetLife claim generator).';
COMMENT ON COLUMN public.matter_details.legal_plan_service_end IS
  'Last date of legal-plan billable work (used by MetLife claim generator).';

CREATE TABLE IF NOT EXISTS public.metlife_claims (
  id                    uuid primary key default gen_random_uuid(),
  matter_id             uuid not null references public.matters(id) on delete cascade,
  document_id           uuid references public.matter_documents(id) on delete set null,
  member_id             text,
  member_name           text,
  spouse_name           text,
  plan_type             text,
  service_start         date,
  service_end           date,
  date_submitted        date,
  total_amount          numeric(12,2),
  sections              jsonb,
  include_realty_trust  boolean not null default false,
  include_minor_guardian boolean not null default false,
  status                text not null default 'draft',
  created_by            uuid references auth.users(id),
  created_at            timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS idx_metlife_claims_matter ON public.metlife_claims(matter_id);
CREATE INDEX IF NOT EXISTS idx_metlife_claims_created_at ON public.metlife_claims(created_at DESC);

ALTER TABLE public.metlife_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_metlife_claims" ON public.metlife_claims;
CREATE POLICY "admin_all_metlife_claims" ON public.metlife_claims
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')));
