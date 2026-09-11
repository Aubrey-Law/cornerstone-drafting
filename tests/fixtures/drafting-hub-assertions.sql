-- Run after the fixture and migration, with ON_ERROR_STOP=1.
do $$
declare r jsonb; a jsonb; b jsonb;
begin
  r := public.drafting_hub_page();
  assert (r->>'total')::int = 1203, 'global total must exceed PostgREST row cap';
  assert jsonb_array_length(r->'rows') = 50, 'browser page bounded';
  assert (r#>>'{actionCounts,design}')::int = 1180;
  assert (r#>>'{actionCounts,review}')::int = 20;
  r := public.drafting_hub_page('', 'review', 'Estate Planning');
  assert (r->>'total')::int = 10;
  assert (r#>>'{actionCounts,all}')::int = 603, 'action facets respect practice, ignore action';
  assert (r#>>'{actionCounts,setup}')::int = 1;
  assert (r#>>'{actionCounts,generate}')::int = 1;
  assert (r#>>'{actionCounts,revise}')::int = 1;
  assert (r#>>'{practiceCounts,0,count}')::int = 10, 'practice facets respect action';
  assert (r#>>'{practiceCounts,1,count}')::int = 10;
  r := public.drafting_hub_page('client 1199', 'all', 'all');
  assert (r->>'total')::int = 1, 'search beyond first 1000';
  assert (r#>>'{rows,0,currentDraftCount}')::int = 9;
  assert jsonb_array_length(r#>'{rows,0,recentDrafts}') = 5;
  r := public.drafting_hub_page('client%');
  assert (r->>'total')::int = 0, 'search metacharacters are literal';
  r := public.drafting_hub_page('missing', 'all', 'all', 'updated', 400);
  assert (r->>'page')::int = 1 and (r->>'total')::int = 0;
  r := public.drafting_hub_page('', 'all', 'all', 'client', 400);
  assert (r->>'page')::int = 25 and jsonb_array_length(r->'rows') = 3, 'empty page clamps to last';
  a := public.drafting_hub_page('', 'all', 'all', 'client', 1);
  b := public.drafting_hub_page('', 'all', 'all', 'client', 2);
  assert a#>>'{rows,49,matter,client_name}' = 'Client 0050';
  assert b#>>'{rows,0,matter,client_name}' = 'Client 0051';
  -- Stable ID tie breaker under identical action/activity/name.
  update public.pipeline_fixture set client_name='Same';
  a := public.drafting_hub_page('', 'all', 'all', 'client', 1);
  b := public.drafting_hub_page('', 'all', 'all', 'client', 2);
  assert not exists (select 1 from jsonb_array_elements(a->'rows') x
    join jsonb_array_elements(b->'rows') y on x#>>'{matter,matter_id}'=y#>>'{matter,matter_id}');
  assert not has_function_privilege('anon', 'public.drafting_hub_page(text,text,text,text,integer,integer)', 'execute');
  assert not has_function_privilege('authenticated', 'public.drafting_hub_page(text,text,text,text,integer,integer)', 'execute');
  assert has_function_privilege('service_role', 'public.drafting_hub_page(text,text,text,text,integer,integer)', 'execute');
end $$;
set role service_role;
select (public.drafting_hub_page()->>'total')::int = 1203 as service_role_read_pass;
reset role;
