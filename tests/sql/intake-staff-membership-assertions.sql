set role service_role;
select public.membership_test_call('add','20000000-0000-0000-0000-000000000003','{"first_name":"New","last_name":"Parent","relationship_label":"Parent"}');
reset role;
do $$ begin
 if not exists(select 1 from contacts where id='20000000-0000-0000-0000-000000000003' and source='client_intake_additional' and relationship_type='other')
 or not exists(select 1 from matter_contacts where contact_id='20000000-0000-0000-0000-000000000003' and matter_id='30000000-0000-0000-0000-000000000001' and relationship_label='Parent') then raise exception 'missing contact/membership'; end if;
 if has_function_privilege('anon','public.change_pinned_intake_contact_membership(text,uuid,timestamptz,text,uuid,jsonb,jsonb)','execute')
 or has_function_privilege('authenticated','public.change_pinned_intake_contact_membership(text,uuid,timestamptz,text,uuid,jsonb,jsonb)','execute') then raise exception 'public access'; end if;
end $$;
select public.membership_reject('add','20000000-0000-0000-0000-000000000004','{"first_name":" new ","last_name":"PARENT"}');
select public.membership_reject('add','20000000-0000-0000-0000-000000000004','{"first_name":""}');
select public.membership_reject('add','20000000-0000-0000-0000-000000000004','{"first_name":"One","last_name":"Two","source":"override"}');
select public.membership_reject('add','20000000-0000-0000-0000-000000000002','{"first_name":"One","last_name":"Two"}');
select public.membership_reject('remove','20000000-0000-0000-0000-000000000001','{}',public.test_contact_snapshot());
select public.membership_reject('remove','20000000-0000-0000-0000-000000000002');
select public.membership_reject('remove','20000000-0000-0000-0000-000000000003');
select public.membership_reject(null,'20000000-0000-0000-0000-000000000003');
select public.membership_reject('remove','20000000-0000-0000-0000-000000000003','{"email":"override"}');
insert into matters values('30000000-0000-0000-0000-000000000002','intake');
select public.membership_reject('add','20000000-0000-0000-0000-000000000004','{"first_name":"One","last_name":"Two"}');
delete from matters where id='30000000-0000-0000-0000-000000000002';
update client_intake set status='approved' where id='intake';
select public.membership_reject('add','20000000-0000-0000-0000-000000000004','{"first_name":"One","last_name":"Two"}');
update client_intake set status='draft' where id='intake';
-- An attachment failure rolls back contact creation and the intake timestamp.
create function public.fail_membership() returns trigger language plpgsql as $$ begin raise exception using errcode='22023',message='injected link failure'; end $$;
create trigger fail_membership before insert on matter_contacts for each row execute function public.fail_membership();
select public.membership_reject('add','20000000-0000-0000-0000-000000000004','{"first_name":"One","last_name":"Two"}');
drop trigger fail_membership on matter_contacts;
-- An intake failure also rolls back removal.
create trigger fail_intake before update on client_intake for each row execute function public.fail_intake_update();
select public.membership_reject('remove','20000000-0000-0000-0000-000000000003','{}',
 (select to_jsonb(c)-array['id','client_intake_id','source','merged_into_id','metadata','relationship_type','relationship_label'] from contacts c where id='20000000-0000-0000-0000-000000000003'));
drop trigger fail_intake on client_intake;
select public.membership_test_call('remove','20000000-0000-0000-0000-000000000003','{}',
 (select to_jsonb(c)-array['id','client_intake_id','source','merged_into_id','metadata','relationship_type','relationship_label'] from contacts c where id='20000000-0000-0000-0000-000000000003'));
do $$ begin
 if not exists(select 1 from contacts where id='20000000-0000-0000-0000-000000000003' and source='client_intake_additional_removed')
 or not exists(select 1 from matter_contacts where contact_id='20000000-0000-0000-0000-000000000003')
 or (select count(*) from contact_roles)<>1 then raise exception 'removal destroyed record or appointments'; end if;
end $$;
select public.membership_test_call('add','20000000-0000-0000-0000-000000000004','{"first_name":"Lock","last_name":"Check"}');

select public.membership_reject('add','20000000-0000-0000-0000-000000000005','{"first_name":"Stale","last_name":"Timestamp"}','{}','2000-01-01T00:00:00Z');
select public.membership_reject('add','20000000-0000-0000-0000-000000000005','{"first_name":"Wrong","last_name":"Version"}','{}',null,'10000000-0000-0000-0000-000000000002');
update client_intake set form_version_id='10000000-0000-0000-0000-000000000001',updated_at='2026-10-09T12:00:00Z' where id='other';
select public.change_pinned_intake_contact_membership('other','10000000-0000-0000-0000-000000000001','2026-10-09T12:00:00Z','add','20000000-0000-0000-0000-000000000006','{}','{"first_name":"Lead","last_name":"Contact"}');
do $$ begin
 if not exists(select 1 from contacts where id='20000000-0000-0000-0000-000000000006')
 or exists(select 1 from matter_contacts where contact_id='20000000-0000-0000-0000-000000000006') then raise exception 'lead-only creation failed'; end if;
end $$;
