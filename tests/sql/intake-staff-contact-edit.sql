create table public.client_intake(id text primary key, form_version_id uuid, updated_at timestamptz, status text);
create table public.contacts(id uuid primary key, client_intake_id text references public.client_intake(id), source text, merged_into_id uuid,
 first_name text, middle_name text, last_name text, suffix text, preferred_pronoun text, email text, phone text,
 address_line1 text, address_line2 text, city text, state text, zip text, metadata jsonb);
create table public.contact_roles(contact_id uuid references public.contacts(id), role text);
grant select,update on public.client_intake,public.contacts to service_role;
insert into public.client_intake values ('intake','10000000-0000-0000-0000-000000000001','2026-10-09T12:00:00Z','draft'),('other',null,null,'draft');
insert into public.contacts(id,client_intake_id,source,first_name,last_name,email,metadata) values
 ('20000000-0000-0000-0000-000000000001','intake','client_intake_additional','Ada','Parent','old@example.test','{"preserve":true}'),
 ('20000000-0000-0000-0000-000000000002','other','client_intake_additional','Other','Person',null,null);
insert into public.contact_roles values('20000000-0000-0000-0000-000000000001','hcp');
create function public.test_contact_snapshot() returns jsonb language sql as $$
 select to_jsonb(c) - array['id','client_intake_id','source','merged_into_id','metadata'] from public.contacts c where id='20000000-0000-0000-0000-000000000001';
$$;
