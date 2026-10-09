alter table public.contacts add column relationship_type text not null default 'other', add column relationship_label text;
create table public.matters(id uuid primary key,client_intake_id text references public.client_intake(id));
create table public.matter_contacts(matter_id uuid references public.matters(id),contact_id uuid references public.contacts(id),relationship_type text,relationship_label text,unique(matter_id,contact_id));
insert into public.matters values('30000000-0000-0000-0000-000000000001','intake');
grant select,update on public.matters to service_role;
grant select on public.contact_roles to service_role;
grant insert on public.contacts,public.matter_contacts to service_role;
grant select on public.matter_contacts to service_role;
create or replace function public.test_contact_snapshot() returns jsonb language sql as $$
 select to_jsonb(c) - array['id','client_intake_id','source','merged_into_id','metadata','relationship_type','relationship_label'] from public.contacts c where id='20000000-0000-0000-0000-000000000001';
$$;
create function public.membership_test_call(op text,cid uuid,patch jsonb default '{}',expected jsonb default '{}',stamp timestamptz default null,version uuid default '10000000-0000-0000-0000-000000000001') returns void language sql as $$
 select public.change_pinned_intake_contact_membership('intake',version,coalesce(stamp,(select updated_at from client_intake where id='intake')),op,cid,expected,patch);
$$;
create function public.membership_reject(op text,cid uuid,patch jsonb default '{}',expected jsonb default '{}',stamp timestamptz default null,version uuid default '10000000-0000-0000-0000-000000000001') returns void language plpgsql as $$
declare rejected boolean:=false; before_contacts jsonb; before_links jsonb; before_intake jsonb;
begin
 select jsonb_agg(to_jsonb(c) order by id) into before_contacts from contacts c;
 select jsonb_agg(to_jsonb(c) order by contact_id) into before_links from matter_contacts c;
 select to_jsonb(i) into before_intake from client_intake i where id='intake';
 begin perform public.membership_test_call(op,cid,patch,expected,stamp,version);
 exception when sqlstate '22023' or sqlstate '40001' or unique_violation then rejected:=true; end;
 if not rejected or before_contacts is distinct from (select jsonb_agg(to_jsonb(c) order by id) from contacts c)
 or before_links is distinct from (select jsonb_agg(to_jsonb(c) order by contact_id) from matter_contacts c)
 or before_intake is distinct from (select to_jsonb(i) from client_intake i where id='intake') then raise exception 'membership rejection changed state'; end if;
end $$;
