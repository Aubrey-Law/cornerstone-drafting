-- Align matter_details.practice_area with the canonical short codes used in
-- lib/practiceArea.ts (PracticeAreaCode = 'EP' | 'EP-LP' | 'Probate').
-- The previous constraint enforced the long-form labels, which the application
-- has since stopped writing — the dropdown now sends 'EP'/'EP-LP'/'Probate'.

ALTER TABLE matter_details DROP CONSTRAINT IF EXISTS matter_details_practice_area_check;

UPDATE matter_details SET practice_area = 'EP'      WHERE practice_area = 'Estate Planning';
UPDATE matter_details SET practice_area = 'EP-LP'   WHERE practice_area IN ('Estate Planning (LP)', 'Estate Planning | LP');
UPDATE matter_details SET practice_area = 'Probate' WHERE practice_area = 'Probate (LP)';

ALTER TABLE matter_details
  ADD CONSTRAINT matter_details_practice_area_check
  CHECK (practice_area IS NULL OR practice_area IN ('EP', 'EP-LP', 'Probate'));
