-- Run only against the synthetic full-chain acceptance stack. All writes roll back.
begin;
create function pg_temp.household_call(kind text,op text,person uuid,patch jsonb,expected jsonb default null) returns void language plpgsql as $$
declare i public.client_intake%rowtype;
begin
 select * into strict i from public.client_intake where email='estate-acceptance@example.test';
 perform public.edit_pinned_intake_household(i.id::text,i.form_version_id,i.updated_at,kind,op,person,expected,patch);
end;$$;
create function pg_temp.household_snapshot(person uuid) returns jsonb language sql as $$
 select jsonb_object_agg(k,to_jsonb(c)->k) from public.contacts c cross join unnest(array['first_name','middle_name','last_name','suffix','preferred_pronoun','email','phone','address_line1','address_line2','city','state','zip','date_of_birth','preferred_name','prior_names','citizenship_status','child_relationship','parentage']) k where c.id=person;
$$;
create function pg_temp.reject(statement text) returns void language plpgsql as $$begin begin execute statement;exception when others then return;end;raise exception 'Expected failure: %',statement;end;$$;
insert into public.design_sheets(matter_id,client_intake_id,version,decisions)
 select m.id,i.id,999,'{"preserve":"yes"}' from public.client_intake i join public.matters m on m.client_intake_id=i.id where i.email='estate-acceptance@example.test';
set local role service_role;
select pg_temp.household_call('child','add','21000000-0000-0000-0000-000000000001','{"first_name":"Test","last_name":"Child","date_of_birth":"2015-01-01","child_relationship":"adopted","parentage":"joint"}');
select pg_temp.household_call('spouse','add','21000000-0000-0000-0000-000000000002','{"first_name":"Test","last_name":"Spouse","citizenship_status":"permanent_resident"}');
select pg_temp.household_call('child','edit','21000000-0000-0000-0000-000000000001','{"middle_name":"Updated"}',pg_temp.household_snapshot('21000000-0000-0000-0000-000000000001'));
reset role;
do $$begin
 if not exists(select 1 from public.contacts where id='21000000-0000-0000-0000-000000000002' and is_us_citizen=false) then raise exception 'Spouse citizenship failed';end if;
 if not exists(select 1 from public.design_sheets where version=999 and decisions->>'preserve'='yes' and children->0->>'name'='Test Child' and children->0->>'relationship'='adopted' and children->0->>'is_minor'='true') then raise exception 'Child projection failed';end if;
end;$$;
select pg_temp.reject($q$select pg_temp.household_call('spouse','add','21000000-0000-0000-0000-000000000003','{"first_name":"Another","last_name":"Spouse"}')$q$);
select pg_temp.reject($q$select pg_temp.household_call('child','edit','21000000-0000-0000-0000-000000000001','{"last_name":"Stale"}','{}')$q$);
select pg_temp.household_call('child','remove','21000000-0000-0000-0000-000000000001','{}',pg_temp.household_snapshot('21000000-0000-0000-0000-000000000001'));
do $$begin
 if not exists(select 1 from public.contacts where id='21000000-0000-0000-0000-000000000001' and relationship_type='other') then raise exception 'Removal deleted person';end if;
 if not exists(select 1 from public.design_sheets where version=999 and children='[]') then raise exception 'Last child projection was not cleared';end if;
end;$$;
insert into public.contact_roles(contact_id,role,for_party,priority,is_coagent) values('21000000-0000-0000-0000-000000000002','hcp','client',1,false);
select pg_temp.reject($q$select pg_temp.household_call('spouse','remove','21000000-0000-0000-0000-000000000002','{}',pg_temp.household_snapshot('21000000-0000-0000-0000-000000000002'))$q$);
create function pg_temp.fail_projection() returns trigger language plpgsql as $$begin raise exception 'Injected projection failure';end;$$;
create trigger fail_projection before update on public.design_sheets for each row execute function pg_temp.fail_projection();
select pg_temp.reject($q$select pg_temp.household_call('child','add','21000000-0000-0000-0000-000000000003','{"first_name":"Rollback","last_name":"Child"}')$q$);
do $$begin if exists(select 1 from public.contacts where id='21000000-0000-0000-0000-000000000003') then raise exception 'Contact insert escaped projection rollback';end if;end;$$;
rollback;
