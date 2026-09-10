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
     and coalesce(d.decisions, '{}'::jsonb) ?| array(select jsonb_object_keys(m.li_design_sheet_data));

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
