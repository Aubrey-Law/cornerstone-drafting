-- Probate intake: the standard list of what the firm needs from a personal
-- representative, sent as document requests and tracked in the portal.
--
-- A probate matter starts with the same handful of asks every time: the death
-- certificate, the will, who the heirs are, what the decedent owned and what
-- they owed. Until now each was typed as a separate request, or asked for in
-- an email. The list now lives in code (lib/documentRequests/probateSet.ts);
-- the attorney ticks what this estate needs and sends it in one step.
--
--   section       which part of the portal list a request sits under
--                 (death certificate, will, heirs, assets, debts, taxes);
--                 null for a one-off request typed by hand
--   template_key  the standard item a request was made from, so sending the
--                 list again adds only what is missing, and a request the
--                 attorney waived is not asked for a second time

ALTER TABLE public.document_requests
  ADD COLUMN IF NOT EXISTS section text,
  ADD COLUMN IF NOT EXISTS template_key text;

ALTER TABLE public.document_requests
  DROP CONSTRAINT IF EXISTS document_requests_section_check;
ALTER TABLE public.document_requests
  ADD CONSTRAINT document_requests_section_check
  CHECK (section IS NULL OR section IN ('death', 'will', 'heirs', 'assets', 'debts', 'taxes'));

ALTER TABLE public.document_requests
  DROP CONSTRAINT IF EXISTS document_requests_template_key_check;
ALTER TABLE public.document_requests
  ADD CONSTRAINT document_requests_template_key_check
  CHECK (template_key IS NULL OR template_key ~ '^[a-z][a-z0-9_]{0,63}$');

-- Not partial, so the insert can name it as its conflict target; NULL keys
-- (hand-typed requests) never collide with one another.
CREATE UNIQUE INDEX IF NOT EXISTS document_requests_matter_template_key_idx
  ON public.document_requests (matter_id, template_key);

COMMENT ON COLUMN public.document_requests.section IS
  'Portal grouping for a request made from a standard list (death, will, heirs, assets, debts, taxes). Null for a one-off request.';
COMMENT ON COLUMN public.document_requests.template_key IS
  'The standard list item a request was made from. Unique per matter, so the list is never sent twice.';

NOTIFY pgrst, 'reload schema';
