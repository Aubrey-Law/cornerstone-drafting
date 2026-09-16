-- Allow durable Statular client creation jobs. Existing rows and grants remain
-- untouched; synchronization is still gated by integration_settings.
begin;

alter table public.workflow_jobs drop constraint workflow_jobs_job_type_check;
alter table public.workflow_jobs add constraint workflow_jobs_job_type_check check (job_type in (
  'seed_design_sheet', 'ensure_sla_plan', 'fire_stage_task',
  'release_billing_milestone', 'annual_review', 'prepare_invoice_reminders',
  'lawmatics_sync_appointment', 'statular_create_client'
));

notify pgrst, 'reload schema';
commit;
