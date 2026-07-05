-- Design sheet: add a canonical Signing Date (replaces the month/year text inputs
-- in the UI; signing_month/signing_year are still populated, derived from this date,
-- so existing drafting consumers keep working) and an explicit toggle for whether a
-- DPOA self-dealing reviewer is included.

ALTER TABLE design_sheets
  ADD COLUMN IF NOT EXISTS signing_date date;

ALTER TABLE design_sheets
  ADD COLUMN IF NOT EXISTS dpoa_include_self_dealing boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN design_sheets.signing_date IS
  'Canonical signing date chosen at the signing meeting. signing_month/signing_year are derived from this for drafting.';
COMMENT ON COLUMN design_sheets.dpoa_include_self_dealing IS
  'Whether the DPOA names a self-dealing reviewer (Section K). When false, the reviewer fields are omitted.';
