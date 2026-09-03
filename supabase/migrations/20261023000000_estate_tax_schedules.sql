-- Estate tax figures as firm configuration rather than constants in a deploy.
--
-- lib/estateTax.ts hard-coded the entire Massachusetts rate table, with the
-- exemption in a comment and no effective date anywhere, alongside a federal
-- exclusion labelled "2025 figure". Nothing marked either stale when the law
-- moved, and a stale exemption quoted to a client reads exactly like a current
-- one — which is the whole problem. The federal basic exclusion is indexed and
-- changes most years, so "wait for a deploy" was never going to keep up.
--
-- Schedules now carry the window they apply to and the authority they came
-- from, and rows here override the bundled ones in lib/estateTaxSchedules.ts.
-- Validation is `estateTaxSchedulesSchema` in lib/estateTaxSettings.ts, not a
-- CHECK constraint: the shape has optional parts that differ by jurisdiction,
-- and a CHECK would turn every future field into a migration of existing rows.
-- Same reasoning as style_sets.settings.
--
-- A date no schedule covers resolves to "not on file" rather than the nearest
-- figure. That refusal is deliberate — it puts the question to the attorney
-- instead of letting the app approximate a number a client will rely on.

ALTER TABLE public.firm_settings
  ADD COLUMN IF NOT EXISTS estate_tax_schedules jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.firm_settings.estate_tax_schedules IS
  'Effective-dated estate tax schedules, parsed by estateTaxSchedulesSchema in lib/estateTaxSettings.ts. Overrides the bundled schedules in lib/estateTaxSchedules.ts for the same jurisdiction and effective_from. Empty array means use the bundled figures.';
