-- Matters brought in from before Cornerstone.
--
-- The firm is moving existing clients onto the app: matters already engaged,
-- drafted outside Cornerstone, often signed years ago. Every create path starts
-- a matter at intake with a task plan dated from today, and that plan's client
-- nudges would email someone whose plan was signed in 2023 about an organizer
-- they finished long ago. `POST /api/admin/matters/import` creates them without
-- that machinery and stamps this column, so the record says how it arrived and
-- lists can tell an imported matter from one that ran the workflow.
alter table public.matters
  add column if not exists imported_at timestamptz;

comment on column public.matters.imported_at is
  'When this matter was brought into Cornerstone from outside it (POST /api/admin/matters/import). Null for matters created through the normal workflow.';
