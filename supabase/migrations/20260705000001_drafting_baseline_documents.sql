-- Cornerstone Drafting — documents & matter details (part 2 of 3)

CREATE TABLE IF NOT EXISTS public.matter_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id     text NOT NULL,
  r2_key        text NOT NULL UNIQUE,
  name          text NOT NULL,
  size          bigint NOT NULL DEFAULT 0,
  content_type  text NOT NULL DEFAULT 'application/octet-stream',
  folder        text NOT NULL DEFAULT 'client',
  folder_id     uuid,
  uploaded_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  generation_id uuid,
  generation_engine text CHECK (generation_engine IS NULL OR generation_engine IN ('node', 'supabase', 'python_fallback')),
  marker_count  integer,
  missing_count integer,
  superseded_at timestamptz,
  reviewed_at   timestamptz,
  reviewed_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matter_docs_matter ON public.matter_documents(matter_id);
CREATE INDEX IF NOT EXISTS idx_matter_docs_generation ON public.matter_documents(matter_id, generation_id);
CREATE INDEX IF NOT EXISTS idx_matter_docs_active_drafts
  ON public.matter_documents(matter_id)
  WHERE folder = 'draft' AND superseded_at IS NULL;

CREATE TABLE IF NOT EXISTS public.folders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id        uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  name             text NOT NULL,
  parent_folder_id uuid REFERENCES public.folders(id) ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_folders_matter_id ON public.folders(matter_id);

ALTER TABLE public.matter_documents
  ADD CONSTRAINT matter_documents_folder_id_fkey
  FOREIGN KEY (folder_id) REFERENCES public.folders(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.document_access_audit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid REFERENCES public.matter_documents(id) ON DELETE SET NULL,
  matter_id     text NOT NULL,
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email    text,
  action        text NOT NULL CHECK (action = ANY (ARRAY[
    'view', 'download', 'folder_change', 'delete', 'export', 'review', 'rename'
  ])),
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  document_name text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_access_audit_document
  ON public.document_access_audit(document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_access_audit_matter
  ON public.document_access_audit(matter_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.matter_details (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  practice_area    text,
  referral_source  text,
  flat_fee_amount  numeric,
  open_date        date,
  client_status    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id)
);

CREATE INDEX IF NOT EXISTS idx_matter_details_client ON public.matter_details(client_id);

CREATE TABLE IF NOT EXISTS public.matter_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id  uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  note_type  text NOT NULL DEFAULT 'internal',
  body       text NOT NULL,
  author     text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matter_notes_matter ON public.matter_notes(matter_id);

-- ── RLS: documents ──────────────────────────────────────────────────────────

ALTER TABLE public.matter_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_access_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_matter_documents"
  ON public.matter_documents FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));

CREATE POLICY "clients_select_own_folders"
  ON public.folders FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.matters m WHERE m.id = folders.matter_id AND m.client_id = auth.uid())
  );

CREATE POLICY "attorneys_all_folders"
  ON public.folders FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));

CREATE POLICY "attorneys_select_document_access_audit"
  ON public.document_access_audit FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));

CREATE POLICY "attorneys_all_matter_details"
  ON public.matter_details FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));

CREATE POLICY "clients_read_own_matter_details"
  ON public.matter_details FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.matters m
      WHERE m.id = matter_details.client_id AND m.client_id = auth.uid()
    )
  );

CREATE POLICY "attorneys_all_matter_notes"
  ON public.matter_notes FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));
