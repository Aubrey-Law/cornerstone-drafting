-- Synthetic schema for a disposable PostgreSQL database only.
create table public.matters (id uuid primary key, matter_number text);
create table public.pipeline_fixture (matter_id uuid, matter_name text, stage text, matter_created timestamptz,
  client_name text, client_email text, spouse_name text, spouse_email text, plan_type text, practice_area text, marital_status text);
create view public.v_matter_pipeline as select * from public.pipeline_fixture;
create table public.design_sheets (id uuid primary key, matter_id uuid, status text, version integer, plan_type text, decisions jsonb, updated_at timestamptz, created_at timestamptz);
create table public.matter_documents (id uuid primary key, matter_id text, name text, size integer, created_at timestamptz,
  source text, generation_id text, generation_engine text, marker_count integer, missing_count integer,
  superseded_at timestamptz, reviewed_at timestamptz, reviewed_by uuid, r2_key text, current_version_id uuid);
create table public.doc_selections (design_sheet_id uuid, doc_type text, variant text, party text, selected boolean);
grant select on all tables in schema public to service_role;
insert into public.matters select md5(i::text)::uuid, '2026-' || i from generate_series(1,1203) i;
insert into public.pipeline_fixture select md5(i::text)::uuid, 'Family ' || i,
  case when i <= 1180 then 'drafting' when i <=1200 then 'client_review' when i=1203 then 'revision' else 'drafting' end,
  now()-interval '15 days', 'Client ' || lpad(i::text,4,'0'), 'person' || i || '@example.test', null, null, 'pour_over',
  case when i%2=1 or i>1200 then 'Estate Planning' else 'Probate' end, 'single'
  from generate_series(1,1203) i;
insert into public.design_sheets values
  (md5('sheet1201')::uuid, md5('1201')::uuid, 'draft', 1, 'pour_over', '{"document_inclusions":{"trust":false,"will":false,"dpoa":false,"healthcare":false}}', now(),now()),
  (md5('sheet1202')::uuid, md5('1202')::uuid, 'draft', 1, 'pour_over', '{}',now(),now());
insert into public.matter_documents select md5(('doc'||i)::text)::uuid, md5('1199')::uuid::text,
  'Draft ' || i, 30, now()-i*interval '1 day', 'firm', 'run', 'engine',0,0,null,null,null,'key'||i,null
  from generate_series(1,9) i;
