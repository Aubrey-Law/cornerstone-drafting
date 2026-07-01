/*
  # Matter list query indexes

  Supports the fetchMatterList() rewrite that pushes filtering, sorting, and
  pagination to Postgres instead of fetching all rows and processing in JS.

  ## New indexes

  ### matters
  - `idx_matters_stage`       — stage filter (.eq) and stage sort
  - `idx_matters_client_id`   — portal auth RLS lookups (matters.client_id = auth.uid())
  - `idx_matters_created_at`  — default sort fallback when opened_at is null

  ### matter_details
  - `idx_matter_details_practice_area` — practice area dropdown filter
  - `idx_matter_details_open_date`     — days_open sort (md.open_date surfaces as
                                         opened_at in the pipeline view)

  ## Already-existing indexes (not duplicated here)
  - `matters_matter_number_unique_idx`   ON matters(matter_number)
  - `matter_details_client_id_idx`       ON matter_details(client_id)
  - `idx_matter_details_client_status`   ON matter_details(client_status)
  - `matter_activity_matter_id_idx`      ON matter_activity(matter_id)
  - `matter_activity_created_at_idx`     ON matter_activity(matter_id, created_at DESC)
  - `matter_alerts_active_idx`           ON matter_alerts(matter_id) WHERE is_resolved = false
*/

-- ── matters ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_matters_stage
  ON matters (stage);

CREATE INDEX IF NOT EXISTS idx_matters_client_id
  ON matters (client_id);

CREATE INDEX IF NOT EXISTS idx_matters_created_at
  ON matters (created_at DESC);

-- ── matter_details ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_matter_details_practice_area
  ON matter_details (practice_area);

-- open_date is the source of the `opened_at` column in v_matter_pipeline.
-- Sorted descending to match the default days_open DESC query pattern.
CREATE INDEX IF NOT EXISTS idx_matter_details_open_date
  ON matter_details (open_date DESC);
