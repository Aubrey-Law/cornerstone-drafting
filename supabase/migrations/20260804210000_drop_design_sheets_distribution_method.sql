-- Drop design_sheets.distribution_method.
--
-- The residual beneficiary method was written to both this column and
-- decisions.trust_details.residual_beneficiary_method, and the two drifted. The
-- decisions blob is now the single home: every sheet that had a method has been
-- backfilled (scripts/backfillResidualBeneficiaryMethod.ts), the one value that
-- matched no option was cleared, and no code reads the column any more.
--
-- ORDER MATTERS. Apply this only AFTER the code that stops writing the column is
-- deployed. The design-sheet PATCH sends its payload through PostgREST, which
-- rejects unknown columns outright, so running this against the previous release
-- fails every design-sheet save with "Unable to save design sheet after several
-- attempts". Re-run the backfill first if any time has passed since it last ran:
-- the old release dual-writes, and its import path writes the column alone.

ALTER TABLE design_sheets DROP COLUMN IF EXISTS distribution_method;
