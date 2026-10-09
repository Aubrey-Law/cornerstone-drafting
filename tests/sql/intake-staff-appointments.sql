create table public.client_intake(id text primary key,form_version_id uuid,updated_at timestamptz,status text,fiduciary_entries jsonb);
create table public.matters(id uuid primary key,client_intake_id text references public.client_intake(id));
create table public.contacts(id uuid primary key,client_intake_id text references public.client_intake(id),merged_into_id uuid,source text);
create table public.matter_contacts(matter_id uuid references public.matters(id),contact_id uuid references public.contacts(id),primary key(matter_id,contact_id));
create table public.contact_roles(id uuid primary key default gen_random_uuid(),contact_id uuid references public.contacts(id),client_intake_id text,matter_id uuid references public.matters(id),role text,for_party text,priority integer,is_coagent boolean,metadata jsonb);
grant select,insert,update,delete on all tables in schema public to service_role;
insert into client_intake values('intake','10000000-0000-0000-0000-000000000001','2026-10-09T12:00:00Z','draft','{"fid_poa_client":[{"first_name":"Old"}],"children":[{"first_name":"Keep"}]}'),('other',null,null,'draft',null);
insert into matters values('30000000-0000-0000-0000-000000000001','intake'),('30000000-0000-0000-0000-000000000002','other');
insert into contacts values('20000000-0000-0000-0000-000000000001','intake',null,null),('20000000-0000-0000-0000-000000000002','intake',null,null),('20000000-0000-0000-0000-000000000003','other',null,null);
insert into matter_contacts select '30000000-0000-0000-0000-000000000001',id from contacts where client_intake_id='intake';
insert into contact_roles(id,contact_id,client_intake_id,matter_id,role,for_party,priority,is_coagent,metadata) values
('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','intake','30000000-0000-0000-0000-000000000001','poa','client',1,false,'{"keep":true}'),
('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','intake','30000000-0000-0000-0000-000000000001','poa','client',1,true,null),
('40000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','intake','30000000-0000-0000-0000-000000000001','poa','spouse',1,false,null),
('40000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','other','30000000-0000-0000-0000-000000000002','poa','client',1,false,null);
create function public.appointment_snapshot() returns jsonb language sql as $$select coalesce(jsonb_agg(to_jsonb(r)-array['client_intake_id','matter_id','metadata'] order by id),'[]'::jsonb) from contact_roles r where matter_id='30000000-0000-0000-0000-000000000001' and role='poa' and for_party='client' and priority=1 and not is_coagent;$$;
create function public.expect_failure(statement text) returns void language plpgsql as $$begin begin execute statement; exception when others then return; end; raise exception 'Expected rejection: %',statement;end;$$;
