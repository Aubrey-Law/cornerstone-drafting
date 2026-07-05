-- Plan Review feature
-- Adds client-facing design review workflow to matters, design sheets, and contacts.

-- ── matters ──────────────────────────────────────────────────────────────────

ALTER TABLE matters
  ADD COLUMN IF NOT EXISTS design_review_status       text        NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS design_review_sent_at      timestamptz,
  ADD COLUMN IF NOT EXISTS client_review_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_review_notes        jsonb       NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS client_signature           text,
  ADD COLUMN IF NOT EXISTS spouse_signature           text;

COMMENT ON COLUMN matters.design_review_status IS
  'Lifecycle state of the plan review sent to the client. '
  'Values: draft | sent | in_progress | completed';

COMMENT ON COLUMN matters.design_review_sent_at IS
  'Timestamp when the plan review link was first sent to the client.';

COMMENT ON COLUMN matters.client_review_completed_at IS
  'Timestamp when the client submitted their completed review.';

COMMENT ON COLUMN matters.client_review_notes IS
  'Array of note objects left by the client during plan review. '
  'Each element: { id, section, text, created_at, resolved?, resolved_at? }';

COMMENT ON COLUMN matters.client_signature IS
  'Client signature captured during plan review (base64 data-URL or token).';

COMMENT ON COLUMN matters.spouse_signature IS
  'Spouse signature captured during plan review (base64 data-URL or token).';

-- ── design_sheets ─────────────────────────────────────────────────────────────

ALTER TABLE design_sheets
  ADD COLUMN IF NOT EXISTS fiduciary_slot_states jsonb NOT NULL DEFAULT '{}';

COMMENT ON COLUMN design_sheets.fiduciary_slot_states IS
  'Tracks per-slot UI state for fiduciary assignments, keyed by slot identifier.';

-- ── contacts ─────────────────────────────────────────────────────────────────

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS source              text        NOT NULL DEFAULT 'attorney',
  ADD COLUMN IF NOT EXISTS created_by_client_at timestamptz;

COMMENT ON COLUMN contacts.source IS
  'Who created this contact record. Values: attorney | client';

COMMENT ON COLUMN contacts.created_by_client_at IS
  'Timestamp when the client added this contact during self-service intake or plan review.';

-- ── helper functions ─────────────────────────────────────────────────────────

-- Shallow-merge a JSON patch into matters.li_design_sheet_data.
CREATE OR REPLACE FUNCTION merge_li_design_sheet_data(
  p_matter_id uuid,
  p_patch      jsonb
) RETURNS void LANGUAGE sql AS $$
  UPDATE matters
  SET li_design_sheet_data = COALESCE(li_design_sheet_data, '{}') || p_patch
  WHERE id = p_matter_id;
$$;

-- Append a note object to matters.client_review_notes.
CREATE OR REPLACE FUNCTION append_review_note(
  p_matter_id uuid,
  p_note       jsonb
) RETURNS void LANGUAGE sql AS $$
  UPDATE matters
  SET client_review_notes = COALESCE(client_review_notes, '[]') || jsonb_build_array(p_note)
  WHERE id = p_matter_id;
$$;

-- Mark a single note as resolved by id.
CREATE OR REPLACE FUNCTION resolve_review_note(
  p_matter_id  uuid,
  p_note_id    text,
  p_resolved_at timestamptz
) RETURNS void LANGUAGE sql AS $$
  UPDATE matters
  SET client_review_notes = (
    SELECT jsonb_agg(
      CASE
        WHEN note->>'id' = p_note_id
        THEN note || jsonb_build_object('resolved', true, 'resolved_at', p_resolved_at)
        ELSE note
      END
    )
    FROM jsonb_array_elements(client_review_notes) AS note
  )
  WHERE id = p_matter_id;
$$;
