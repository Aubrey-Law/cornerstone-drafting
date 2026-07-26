-- Serialize design-sheet creation.
--
-- Four call sites created design sheets with check-then-insert and nothing to
-- serialize them (lib/designSheet/ensureDesignSheetSeeded.ts, lib/intakeSeed.ts,
-- app/api/admin/matters/[id]/design-sheet/route.ts). Duplicate rows split
-- drafting state: readers pick "max version, newest created" while
-- saveHouseholdChildren picks by client_intake_id, so attorney edits can land on
-- one row and later loads read another.
--
-- One design sheet per (matter_id, version) is the intended invariant, so make
-- the database enforce it and let creators use ON CONFLICT DO NOTHING.
--
-- Deliberately NOT constrained here: client_intake per user. Multiple intake
-- rows for one user is a legitimate state (re-invite, second engagement) — see
-- lib/intake/getOrCreateClientIntake.ts, which handles multiples on purpose. The
-- duplicate cascade there is a query bug, fixed in application code instead.

DO $$
DECLARE
  v_dupes int;
  v_detail text;
BEGIN
  SELECT count(*), string_agg(format('matter_id=%s version=%s (%s rows)', matter_id, version, n), ', ')
    INTO v_dupes, v_detail
  FROM (
    SELECT matter_id, version, count(*) AS n
    FROM public.design_sheets
    GROUP BY matter_id, version
    HAVING count(*) > 1
  ) d;

  IF coalesce(v_dupes, 0) > 0 THEN
    RAISE EXCEPTION
      'Cannot add design_sheets unique index: % duplicate (matter_id, version) group(s) exist: %. '
      'Resolve manually before applying — these rows may hold divergent drafting decisions, '
      'so they must be merged by a human, not auto-deleted. '
      'Inspect with: SELECT matter_id, version, id, updated_at FROM public.design_sheets '
      'WHERE (matter_id, version) IN (SELECT matter_id, version FROM public.design_sheets '
      'GROUP BY matter_id, version HAVING count(*) > 1) ORDER BY matter_id, version, updated_at DESC;',
      v_dupes, v_detail;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS design_sheets_matter_id_version_key
  ON public.design_sheets (matter_id, version);
