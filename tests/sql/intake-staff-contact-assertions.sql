set role service_role;
select public.edit_pinned_intake_contact('intake','10000000-0000-0000-0000-000000000001','2026-10-09T12:00:00Z','20000000-0000-0000-0000-000000000001',public.test_contact_snapshot(),'{"email":"new@example.test"}');
reset role;
do $$ begin
 if (select email from contacts where id='20000000-0000-0000-0000-000000000001') <> 'new@example.test'
 or (select metadata from contacts where id='20000000-0000-0000-0000-000000000001') <> '{"preserve":true}'::jsonb
 or (select count(*) from contact_roles) <> 1 then raise exception 'identity or metadata changed'; end if;
 if has_function_privilege('authenticated','public.edit_pinned_intake_contact(text,uuid,timestamptz,uuid,jsonb,jsonb)','execute')
 or has_function_privilege('anon','public.edit_pinned_intake_contact(text,uuid,timestamptz,uuid,jsonb,jsonb)','execute') then raise exception 'public execution granted'; end if;
end $$;
create function public.expect_contact_rejection(patch jsonb, expected jsonb default public.test_contact_snapshot(), cid uuid default '20000000-0000-0000-0000-000000000001', stamp timestamptz default null, version uuid default '10000000-0000-0000-0000-000000000001') returns void language plpgsql as $$
declare rejected boolean := false; before_row jsonb; after_row jsonb;
begin
 select to_jsonb(c) into before_row from contacts c where id='20000000-0000-0000-0000-000000000001';
 begin
 perform public.edit_pinned_intake_contact('intake',version,coalesce(stamp,(select updated_at from client_intake where id='intake')),cid,expected,patch);
 exception when sqlstate '22023' or sqlstate '40001' then rejected:=true;
 end;
 select to_jsonb(c) into after_row from contacts c where id='20000000-0000-0000-0000-000000000001';
 if not rejected or before_row is distinct from after_row then raise exception 'expected unchanged rejection'; end if;
end $$;
select public.expect_contact_rejection('{"source":"other"}');
select public.expect_contact_rejection('{"email":42}');
select public.expect_contact_rejection('{"first_name":""}');
select public.expect_contact_rejection('{}');
select public.expect_contact_rejection('{"email":"x"}', '{}');
select public.expect_contact_rejection('{"email":"x"}',public.test_contact_snapshot(),'20000000-0000-0000-0000-000000000002');
select public.expect_contact_rejection('{"email":"x"}',public.test_contact_snapshot(),'20000000-0000-0000-0000-000000000001','2026-10-09T12:00:00Z');
select public.expect_contact_rejection('{"email":"x"}',public.test_contact_snapshot(),'20000000-0000-0000-0000-000000000001',null,'10000000-0000-0000-0000-000000000002');
update client_intake set status='submitted' where id='intake';
select public.expect_contact_rejection('{"email":"x"}');
update client_intake set status='draft' where id='intake';
update contacts set source='other' where id='20000000-0000-0000-0000-000000000001';
select public.expect_contact_rejection('{"email":"x"}');
update contacts set source='client_intake_additional',merged_into_id='20000000-0000-0000-0000-000000000002' where id='20000000-0000-0000-0000-000000000001';
select public.expect_contact_rejection('{"email":"x"}');
update contacts set merged_into_id=null where id='20000000-0000-0000-0000-000000000001';
-- Prove a failure after the contact UPDATE rolls the contact write back too.
create function public.fail_intake_update() returns trigger language plpgsql as $$ begin raise exception using errcode='22023',message='injected failure'; end $$;
create trigger fail_intake before update on client_intake for each row execute function public.fail_intake_update();
select public.expect_contact_rejection('{"email":"should-rollback@example.test"}');
drop trigger fail_intake on client_intake;
