-- Push to Lawmatics: Lawmatics' Practice Area, Source and Campaign are built-in
-- picklists, set by option ID rather than text. This map pairs Cornerstone
-- values with the Lawmatics option each should select:
--   { "practice_area": { "EP": "123", ... },
--     "source":        { "<lead source, lower-cased>": "456", ... },
--     "campaign":      { "<lead source, lower-cased>": "789", ... } }
-- Values with no entry are left unset in Lawmatics on push.

alter table public.integration_settings
  add column lawmatics_option_id_map jsonb not null default '{}'::jsonb
    check (jsonb_typeof(lawmatics_option_id_map) = 'object');
