-- Gate Client Review nudges on whether the client has responded this review round.
ALTER TABLE public.matters
  ADD COLUMN IF NOT EXISTS review_responded_at timestamptz;

UPDATE public.nudge_schedule
SET condition = 'review_not_submitted'
WHERE stage_key = 'client_review'
  AND (condition IS NULL OR condition <> 'review_not_submitted');
