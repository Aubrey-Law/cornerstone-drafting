-- College Preparation Plan becomes its own practice area.
--
-- It was a flag inside the design sheet (`decisions.plan_track`), reachable
-- only from a control inside the sheet itself. Practice area is where a matter's
-- type already lives: it is on the matter list, in the filters, and in the
-- matter number, and it has one obvious place to change it. The design sheet's
-- plan track now follows it (lib/designSheet/reconcilePlanTrack.ts).
--
-- `CP` is the code; new matters number as YYYY-CP-<client>-NNN. Matter numbers
-- are allocated at creation and never rewritten, so matters backfilled below
-- keep the EP numbers they were opened under.

ALTER TABLE matter_details DROP CONSTRAINT IF EXISTS matter_details_practice_area_check;

ALTER TABLE matter_details
  ADD CONSTRAINT matter_details_practice_area_check
  CHECK (practice_area IS NULL OR practice_area IN ('EP', 'EP-LP', 'CP', 'Probate'));

-- Backfill: every matter already drafting a College Preparation Plan. Without
-- this they would reconcile the other way on next load — practice area is the
-- source of truth now, so an EP matter with a college-prep sheet would be
-- pulled back to the estate track and lose its student document set.
--
-- Two populations, same outcome:
--   1. sheets already marked `decisions.plan_track = 'college_prep'`
--   2. matters whose intake used the college-prep questionnaire (covers a matter
--      whose sheet was never opened, so was never marked)
WITH college_prep_matters AS (
  SELECT DISTINCT m.id
  FROM matters m
  LEFT JOIN design_sheets ds ON ds.matter_id = m.id
  LEFT JOIN client_intake ci ON ci.id = m.client_intake_id
  WHERE ds.decisions ->> 'plan_track' = 'college_prep'
     OR ci.intake_track = 'college_prep'
)
INSERT INTO matter_details (client_id, practice_area)
SELECT id, 'CP' FROM college_prep_matters
ON CONFLICT (client_id) DO UPDATE
  SET practice_area = 'CP'
  -- Never overwrite a Probate matter: an intake track is not a reason to
  -- reclassify a probate engagement.
  WHERE matter_details.practice_area IS DISTINCT FROM 'Probate';

-- No mirror write: `matters` has no practice_area column. The pipeline views
-- select md.practice_area, so the backfill above is all they need.

COMMENT ON CONSTRAINT matter_details_practice_area_check ON matter_details IS
  'EP | EP-LP | CP (College Preparation Plan) | Probate.';

NOTIFY pgrst, 'reload schema';
