-- Fold matters.li_design_sheet_data into the design sheet's decisions.
--
-- The design sheet has had three homes: columns on `design_sheets`, the
-- `decisions` jsonb beside them, and this blob on `matters`. The third is
-- where `ResiduarySection.tsx` writes, and the audit does not read it — so a
-- check asking "is a residuary recorded?" looked at an always-empty column and
-- raised blocker findings against seven matters that had one.
--
-- Measured 2026-09-10: 10 matters, two keys each
-- (`residuary_spouse_survives`, `residuary_no_spouse`), zero collisions with
-- keys already in `decisions`, and all 10 already have a `design_sheets` row.
-- The collision check below asserts that rather than trusting it: a merge that
-- silently overwrote a recorded decision would be undetectable afterwards.
--
-- The column is NOT dropped. 17 code sites still read it, and the repo's rule
-- (20261013000000_drop_twenty_sync_columns.sql) is that a column is never
-- dropped in the same PR as its last code reference.
--
-- RE-RUNNABLE, and that is deliberate. Because the blob is left in place, a
-- naive "does this key already exist" check would raise on the second run
-- against the very rows the first run folded — in a repository whose
-- documented practice is to re-apply a migration by hand when the history is
-- not trusted, and where a raise here aborts every migration behind it in the
-- same `db push`. So the check asks the narrower question that is actually
-- worth asking: does a key exist *carrying a different value*. An identical
-- key/value pair means this already ran, and re-merging it is a true no-op.
--
-- CHECK-THEN-ACT, acknowledged. The count and the merge are two statements
-- with no lock between them, and `read committed` takes a fresh snapshot per
-- statement, so a concurrent write to one of these ten matters' residuary in
-- the gap would be overwritten by the `||` without the check having seen it.
-- Narrow — it needs a live save to one of ten known matters during the
-- migration — and mitigated by applying with `psql -1`, which is what the
-- plan's apply step specifies. Not closed with a table lock: blocking writes
-- to every design sheet in the practice is a worse trade than a documented
-- window this small.

do $$
declare
  v_collisions int;
begin
  select count(*) into v_collisions
    from public.matters m
    join public.design_sheets d on d.matter_id = m.id
     and d.version = (select max(version) from public.design_sheets x where x.matter_id = m.id)
   where m.li_design_sheet_data is not null
     and m.li_design_sheet_data <> '{}'::jsonb
     and coalesce(d.decisions, '{}'::jsonb) ?| array(select jsonb_object_keys(m.li_design_sheet_data))
     -- `@>` means decisions already carries every one of the blob's key/value
     -- pairs — i.e. this fold has already run. That is not a collision, and
     -- treating it as one is what would make a second run fail.
     and not coalesce(d.decisions, '{}'::jsonb) @> m.li_design_sheet_data;

  if v_collisions > 0 then
    raise exception 'Refusing to fold: % sheet(s) already carry a key from li_design_sheet_data', v_collisions;
  end if;
end $$;

update public.design_sheets d
   set decisions = coalesce(d.decisions, '{}'::jsonb) || m.li_design_sheet_data
  from public.matters m
 where m.id = d.matter_id
   and m.li_design_sheet_data is not null
   and m.li_design_sheet_data <> '{}'::jsonb
   and d.version = (select max(version) from public.design_sheets x where x.matter_id = m.id);

notify pgrst, 'reload schema';
