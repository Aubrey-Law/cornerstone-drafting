-- Intake readiness hardening:
--   * optional-but-tracked attorney review flags
--   * hashed, expiring invite tokens
--   * durable outbox for downstream Lawmatics/design-sheet sync
--   * invite-use audit trail

ALTER TABLE public.client_intake
  ADD COLUMN IF NOT EXISTS attorney_review_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS intake_token_hash text,
  ADD COLUMN IF NOT EXISTS intake_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS intake_token_last_used_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS client_intake_intake_token_hash_idx
  ON public.client_intake (intake_token_hash)
  WHERE intake_token_hash IS NOT NULL;

ALTER TABLE public.design_sheets
  ADD COLUMN IF NOT EXISTS intake_review_flags jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.intake_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_intake_id uuid NOT NULL REFERENCES public.client_intake(id) ON DELETE CASCADE,
  matter_id uuid REFERENCES public.matters(id) ON DELETE SET NULL,
  job_type text NOT NULL CHECK (job_type IN ('lawmatics_sync', 'design_sheet_seed')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS intake_sync_jobs_ready_idx
  ON public.intake_sync_jobs (status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS intake_sync_jobs_client_intake_idx
  ON public.intake_sync_jobs (client_intake_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS intake_sync_jobs_one_active_per_type_idx
  ON public.intake_sync_jobs (client_intake_id, job_type)
  WHERE status IN ('pending', 'running');

DROP TRIGGER IF EXISTS intake_sync_jobs_set_updated_at ON public.intake_sync_jobs;
CREATE TRIGGER intake_sync_jobs_set_updated_at
  BEFORE UPDATE ON public.intake_sync_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.intake_sync_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.intake_sync_jobs FROM anon, authenticated;
GRANT ALL ON public.intake_sync_jobs TO service_role;

CREATE TABLE IF NOT EXISTS public.intake_invite_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_intake_id uuid REFERENCES public.client_intake(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS intake_invite_audit_intake_idx
  ON public.intake_invite_audit (client_intake_id, created_at DESC);

ALTER TABLE public.intake_invite_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.intake_invite_audit FROM anon, authenticated;
GRANT ALL ON public.intake_invite_audit TO service_role;

-- These facts remain important for drafting, but client intake submission no
-- longer blocks on them. They are tracked as attorney review flags instead.
UPDATE public.intake_required_fields
SET alert_detail = 'Client submission does not require this field; confirm during attorney review before drafting.'
WHERE field_path IN (
  'date_of_birth',
  'spouse_dob',
  '_fid_guardian_client',
  '_fid_personal_rep_client',
  '_fid_trustee_client',
  '_fid_poa_client',
  '_fid_hcp_client'
);
