-- System work skills get a stable slug (the directory name in
-- tools/workflows/system/<type>/<slug>/SKILL.md) so repo-bundled skills can be
-- upserted idempotently. Idempotent for the shared firm database.

ALTER TABLE public.work_skills ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.work_skills ADD COLUMN IF NOT EXISTS sort_order integer;

-- Slug identifies a system skill uniquely; custom skills may leave it null.
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_skills_system_slug
  ON public.work_skills(slug)
  WHERE is_system = true;

COMMENT ON COLUMN public.work_skills.slug IS
  'Stable identity for repo-bundled system skills (directory name under tools/workflows/system).';
