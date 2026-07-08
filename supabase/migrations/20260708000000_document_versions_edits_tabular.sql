-- Cornerstone Drafting — document versions, AI edits, estate tabular review
-- Incremental / idempotent for the shared firm database (IF NOT EXISTS).
-- Do NOT run via `supabase db push` against firm — paste into SQL Editor.
-- See supabase/migrations/README.md.

-- ── document_versions ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.document_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id      uuid NOT NULL REFERENCES public.matter_documents(id) ON DELETE CASCADE,
  r2_key           text NOT NULL,
  pdf_r2_key       text,
  source           text NOT NULL DEFAULT 'upload'
                   CHECK (source = ANY (ARRAY[
                     'upload', 'generated', 'assistant_edit', 'user_upload',
                     'user_accept', 'user_reject', 'converted_pdf'
                   ])),
  version_number   integer NOT NULL DEFAULT 1,
  filename         text,
  file_type        text,
  size_bytes       bigint NOT NULL DEFAULT 0,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  deleted_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (document_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_document_versions_document
  ON public.document_versions(document_id, version_number DESC);

CREATE INDEX IF NOT EXISTS idx_document_versions_active
  ON public.document_versions(document_id)
  WHERE deleted_at IS NULL;

-- Pointer on matter_documents to the active version
ALTER TABLE public.matter_documents
  ADD COLUMN IF NOT EXISTS current_version_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'matter_documents_current_version_id_fkey'
  ) THEN
    ALTER TABLE public.matter_documents
      ADD CONSTRAINT matter_documents_current_version_id_fkey
      FOREIGN KEY (current_version_id) REFERENCES public.document_versions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ── document_edits (AI redline cards) ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.document_edits (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id      uuid NOT NULL REFERENCES public.matter_documents(id) ON DELETE CASCADE,
  version_id       uuid NOT NULL REFERENCES public.document_versions(id) ON DELETE CASCADE,
  change_id        text NOT NULL,
  del_w_id         text,
  ins_w_id         text,
  deleted_text     text,
  inserted_text    text,
  context_before   text,
  context_after    text,
  reason           text,
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status = ANY (ARRAY['pending', 'accepted', 'rejected'])),
  created_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolved_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_document_edits_document
  ON public.document_edits(document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_edits_version
  ON public.document_edits(version_id);
CREATE INDEX IF NOT EXISTS idx_document_edits_pending
  ON public.document_edits(document_id)
  WHERE status = 'pending';

-- ── estate tabular multi-doc review ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tabular_reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id        text NOT NULL,
  title            text NOT NULL DEFAULT 'Estate document review',
  columns_config   jsonb NOT NULL DEFAULT '[]'::jsonb,
  document_ids     jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tabular_reviews_matter
  ON public.tabular_reviews(matter_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.tabular_cells (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id        uuid NOT NULL REFERENCES public.tabular_reviews(id) ON DELETE CASCADE,
  document_id      uuid NOT NULL REFERENCES public.matter_documents(id) ON DELETE CASCADE,
  column_index     integer NOT NULL,
  content          text,
  citations        jsonb NOT NULL DEFAULT '[]'::jsonb,
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status = ANY (ARRAY['pending', 'generating', 'done', 'error'])),
  error_message    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, document_id, column_index)
);

CREATE INDEX IF NOT EXISTS idx_tabular_cells_review
  ON public.tabular_cells(review_id, document_id);

-- ── Extend audit actions for AI edit / convert / version ops ────────────────

DO $$
BEGIN
  ALTER TABLE public.document_access_audit
    DROP CONSTRAINT IF EXISTS document_access_audit_action_check;
  ALTER TABLE public.document_access_audit
    ADD CONSTRAINT document_access_audit_action_check
    CHECK (action = ANY (ARRAY[
      'view', 'download', 'folder_change', 'delete', 'export', 'review', 'rename',
      'edit', 'convert', 'version'
    ]));
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'document_access_audit action check refresh skipped: %', SQLERRM;
END $$;

-- ── RLS (attorney/admin; service role used by API bypasses RLS) ─────────────

ALTER TABLE public.document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_edits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tabular_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tabular_cells ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'admin_all_document_versions'
  ) THEN
    CREATE POLICY "admin_all_document_versions"
      ON public.document_versions FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')))
      WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'admin_all_document_edits'
  ) THEN
    CREATE POLICY "admin_all_document_edits"
      ON public.document_edits FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')))
      WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'admin_all_tabular_reviews'
  ) THEN
    CREATE POLICY "admin_all_tabular_reviews"
      ON public.tabular_reviews FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')))
      WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'admin_all_tabular_cells'
  ) THEN
    CREATE POLICY "admin_all_tabular_cells"
      ON public.tabular_cells FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')))
      WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));
  END IF;
END $$;

COMMENT ON TABLE public.document_versions IS
  'Immutable-ish DOCX/PDF revision history for matter_documents; current_version_id points here.';
COMMENT ON TABLE public.document_edits IS
  'Pending/accepted/rejected AI tracked-change cards tied to a document_versions snapshot.';
COMMENT ON TABLE public.tabular_reviews IS
  'Matter-scoped multi-document estate review grids (documents × question columns).';
