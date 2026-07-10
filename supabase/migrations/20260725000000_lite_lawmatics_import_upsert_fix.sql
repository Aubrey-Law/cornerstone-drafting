-- Lawmatics import upsert fix
-- PostgREST .upsert(onConflict: 'lawmatics_matter_id') emits ON CONFLICT (lawmatics_matter_id)
-- without a predicate, which cannot use a partial unique index.

DROP INDEX IF EXISTS public.client_intake_lawmatics_matter_id_key;

CREATE UNIQUE INDEX client_intake_lawmatics_matter_id_key
  ON public.client_intake (lawmatics_matter_id);

NOTIFY pgrst, 'reload schema';
