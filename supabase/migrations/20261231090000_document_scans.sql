-- Issue spotting and proofreading runs from the Word add-in, kept in review
-- history beside the playbook reviews.
--
-- Not workflow_runs. A run there pins a prompt version, has one step per
-- rule, and is worked by the run queue; a scan has no playbook, no rules and
-- nothing for the queue to finish — it runs once, in the request that asked
-- for it. Its items are not findings either: a finding answers a numbered rule
-- with an outcome, an item is an open-ended observation with a category and an
-- importance. Forcing either into the other's table would mean columns that
-- are always null for one kind and a worker that must learn to skip rows.
--
-- A scan anchors to the same snapshot a playbook review keeps
-- (`review_uploads`) and to that snapshot's text layer, so a scan run with a
-- review shares the review's copy of the document, and every item's
-- paragraph and character offsets index text that is stored.
--
-- Safe against the release already running (see supabase/migrations/README.md):
-- two new tables, nothing existing altered.

create table if not exists public.document_scans (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind = any (array['issues', 'proofread'])),
  review_upload_id uuid not null references public.review_uploads(id) on delete cascade,
  text_layer_id uuid not null references public.document_text_layers(id) on delete cascade,
  model text,
  -- running while the request works it; a request that died leaves it running,
  -- which the history page reads as "did not finish", never as clean.
  status text not null default 'running'
    check (status = any (array['running', 'completed', 'partial', 'failed', 'stopped'])),
  section_total integer check (section_total is null or section_total >= 0),
  section_completed integer not null default 0 check (section_completed >= 0),
  item_count integer not null default 0 check (item_count >= 0),
  -- Sections that failed, by number and reason: named, never folded into a count.
  failures jsonb not null default '[]'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

comment on table public.document_scans is
  'An issue-spotting or proofreading pass over a document, run from the Word add-in. Anchors to a review_uploads snapshot and its text layer.';

create index if not exists document_scans_review_upload_idx on public.document_scans (review_upload_id);
create index if not exists document_scans_started_idx on public.document_scans (started_at desc);

create table if not exists public.document_scan_items (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.document_scans(id) on delete cascade,
  -- Order within the scan: section, then position in that section's answer.
  sequence integer not null check (sequence >= 0),
  -- The id the pane knew the item by while it streamed, so a decision made in
  -- Word can name the item before the pane has ever seen its row id.
  item_key text not null check (length(btrim(item_key)) > 0),
  category text not null check (length(btrim(category)) > 0),
  importance text not null check (importance = any (array['important', 'notable', 'minor'])),
  title text not null check (length(btrim(title)) > 0),
  explanation text not null default '',
  -- Kept only for a verified quote: a replacement is meaningless without the passage.
  replacement text,
  -- The verified citation, all or nothing. An item whose quote could not be
  -- found keeps what it tried to quote and why it was refused instead.
  block_index integer,
  char_start integer,
  char_end integer,
  quote text,
  citation_refusal text,
  attempted_quote text,
  -- The attorney's decision, as for a playbook finding: open is no decision.
  disposition text not null default 'open'
    check (disposition = any (array['open', 'accepted', 'rejected', 'deferred'])),
  disposition_note text,
  disposition_by uuid references public.users(id) on delete set null,
  disposition_at timestamptz,
  created_at timestamptz not null default now(),
  constraint document_scan_items_citation_whole
    check (
      (block_index is null and char_start is null and char_end is null and quote is null)
      or (block_index is not null and char_start is not null and char_end is not null and quote is not null
          and char_end > char_start)
    ),
  constraint document_scan_items_replacement_needs_citation
    check (replacement is null or quote is not null),
  constraint document_scan_items_decision_stamped
    check ((disposition = 'open') = (disposition_at is null)),
  unique (scan_id, sequence),
  unique (scan_id, item_key)
);

comment on table public.document_scan_items is
  'One observation from a document scan. The citation columns are set only when the quote was verified against the scan''s text layer.';

alter table public.document_scans enable row level security;
alter table public.document_scan_items enable row level security;

drop policy if exists "Staff read document scans" on public.document_scans;
create policy "Staff read document scans" on public.document_scans
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')
    )
  );

drop policy if exists "Staff read document scan items" on public.document_scan_items;
create policy "Staff read document scan items" on public.document_scan_items
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')
    )
  );
