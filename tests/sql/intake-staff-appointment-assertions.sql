create function public.appointment_test_call(person uuid) returns void language sql as $$
 select public.edit_pinned_intake_appointment('intake','10000000-0000-0000-0000-000000000001',
 (select updated_at from client_intake where id='intake'),'30000000-0000-0000-0000-000000000001','poa','client',1,false,person,public.appointment_snapshot());$$;
begin;
set local role service_role;
select public.appointment_test_call('20000000-0000-0000-0000-000000000002');
reset role;
do $$begin
 if (select count(*) from contact_roles)<>4 then raise exception 'Other roles changed';end if;
 if not exists(select 1 from contact_roles where id='40000000-0000-0000-0000-000000000001' and contact_id='20000000-0000-0000-0000-000000000002' and metadata='{"keep":true}') then raise exception 'Identity or metadata lost';end if;
 if (select fiduciary_entries ? 'fid_poa_client' from client_intake where id='intake') or not (select fiduciary_entries ? 'children' from client_intake where id='intake') then raise exception 'Embedded data not preserved correctly';end if;
end;$$;
select public.appointment_test_call(null);
do $$begin if (select count(*) from contact_roles)<>3 then raise exception 'Wrong removal scope';end if;end;$$;
select public.appointment_test_call('20000000-0000-0000-0000-000000000001');
do $$begin if (select count(*) from contact_roles)<>4 then raise exception 'Insert failed';end if;end;$$;
rollback;
select public.expect_failure($q$select public.appointment_test_call('20000000-0000-0000-0000-000000000003')$q$);
select public.expect_failure($q$select public.edit_pinned_intake_appointment('intake','10000000-0000-0000-0000-000000000001','2026-10-09T12:00:00Z','30000000-0000-0000-0000-000000000001','poa','client',1,false,null,'[]')$q$);
begin;
update client_intake set status='submitted' where id='intake';
select public.expect_failure($q$select public.appointment_test_call(null)$q$);
rollback;
begin;
update contacts set source='client_intake_additional_removed' where id='20000000-0000-0000-0000-000000000002';
select public.expect_failure($q$select public.appointment_test_call('20000000-0000-0000-0000-000000000002')$q$);
rollback;
do $$begin
 if has_function_privilege('anon','public.edit_pinned_intake_appointment(text,uuid,timestamptz,uuid,text,text,integer,boolean,uuid,jsonb)','execute') or has_function_privilege('authenticated','public.edit_pinned_intake_appointment(text,uuid,timestamptz,uuid,text,text,integer,boolean,uuid,jsonb)','execute') then raise exception 'Public RPC access';end if;
end;$$;
begin;
create function public.reject_appointment_intake() returns trigger language plpgsql as $$begin raise exception 'Injected update failure';end;$$;
create trigger fail_write before update on client_intake for each row execute function public.reject_appointment_intake();
select public.expect_failure($q$select public.appointment_test_call('20000000-0000-0000-0000-000000000002')$q$);
do $$begin if not exists(select 1 from contact_roles where id='40000000-0000-0000-0000-000000000001' and contact_id='20000000-0000-0000-0000-000000000001') then raise exception 'Role write escaped rollback';end if;end;$$;
rollback;
