-- OneDrive folder mirror columns. Replaces the Google Drive mirror (drive_folder_id*).
-- The drive_folder_id* columns remain in place for backfill/reference; they are no longer written.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS onedrive_folder_id   text,
  ADD COLUMN IF NOT EXISTS onedrive_folder_path text,
  ADD COLUMN IF NOT EXISTS onedrive_delta_token text,
  ADD COLUMN IF NOT EXISTS onedrive_last_synced_at timestamptz;

COMMENT ON COLUMN public.leads.onedrive_folder_id IS
  'Microsoft Graph driveItem id for the lead''s OneDrive folder under /Aubrey Law/Leads/.';
COMMENT ON COLUMN public.leads.onedrive_folder_path IS
  'Server-relative path inside the drive (e.g. /Aubrey Law/Leads/Smith, John — 2026).';

ALTER TABLE public.matters
  ADD COLUMN IF NOT EXISTS onedrive_folder_id        text,
  ADD COLUMN IF NOT EXISTS onedrive_folder_path      text,
  ADD COLUMN IF NOT EXISTS onedrive_intake_folder_id text,
  ADD COLUMN IF NOT EXISTS onedrive_design_folder_id text,
  ADD COLUMN IF NOT EXISTS onedrive_drafts_folder_id text,
  ADD COLUMN IF NOT EXISTS onedrive_signed_folder_id text,
  ADD COLUMN IF NOT EXISTS onedrive_correspondence_folder_id text,
  ADD COLUMN IF NOT EXISTS onedrive_delta_token      text,
  ADD COLUMN IF NOT EXISTS onedrive_last_synced_at   timestamptz;

-- Loop guard: when the cron sees a file with this id, it skips ingest. When the
-- mirror uploads to OneDrive, it stamps the returned driveItem id here.
ALTER TABLE public.matter_documents
  ADD COLUMN IF NOT EXISTS onedrive_item_id text;
ALTER TABLE public.lead_documents
  ADD COLUMN IF NOT EXISTS onedrive_item_id text;

CREATE INDEX IF NOT EXISTS idx_matter_documents_onedrive_item_id
  ON public.matter_documents(onedrive_item_id)
  WHERE onedrive_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_documents_onedrive_item_id
  ON public.lead_documents(onedrive_item_id)
  WHERE onedrive_item_id IS NOT NULL;
