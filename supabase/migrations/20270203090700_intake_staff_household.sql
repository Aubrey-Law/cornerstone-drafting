-- Atomic spouse/child changes, including the existing child design projection.
create or replace function public.edit_pinned_intake_household(
 p_intake_id text,p_version_id uuid,p_updated_at timestamptz,p_kind text,p_operation text,
 p_contact_id uuid,p_expected jsonb,p_patch jsonb
) returns void language plpgsql security invoker set search_path='' as $$
declare
  v_intake_id public.client_intake.id%type;
 intake public.client_intake%rowtype;
 person public.contacts%rowtype;
 revised public.contacts%rowtype;
 matter_ids uuid[];
 snapshot jsonb;
 child_projection jsonb;
 allowed text[]:=array['first_name','middle_name','last_name','suffix','preferred_pronoun','email','phone','address_line1','address_line2','city','state','zip','date_of_birth','preferred_name','prior_names','citizenship_status','child_relationship','parentage'];
begin
  v_intake_id := p_intake_id;
 if p_kind is null or p_kind not in ('spouse','child') or p_operation is null or p_operation not in ('add','edit','remove')
   or jsonb_typeof(p_patch) is distinct from 'object' or p_contact_id is null then
   raise exception using errcode='22023',message='Invalid household edit.';
 end if;
 if exists(select 1 from jsonb_each(p_patch) e where not (e.key=any(allowed)) or jsonb_typeof(e.value) not in ('string','null') or length(e.value#>>'{}')>2000)
   or (p_operation='remove' and p_patch<>'{}'::jsonb) then raise exception using errcode='22023',message='Invalid household fields.';end if;
 select coalesce(array_agg(m.id order by m.id),array[]::uuid[]) into matter_ids
 from (select id from public.matters where client_intake_id=v_intake_id order by id for share) m;
 select * into intake from public.client_intake where id=v_intake_id for update;
 if not found or intake.form_version_id is null or intake.form_version_id is distinct from p_version_id
   or intake.updated_at is distinct from p_updated_at or intake.status in ('submitted','approved') then
   raise exception using errcode='40001',message='The questionnaire changed. Close and reopen the intake before editing.';
 end if;
 if cardinality(matter_ids)>1 or matter_ids is distinct from (select coalesce(array_agg(id order by id),array[]::uuid[]) from public.matters where client_intake_id=v_intake_id) then
   raise exception using errcode='40001',message='Review the matter links before editing the household.';
 end if;
 -- Serialize with legacy household writers, including an initially empty list.
 lock table public.contacts in share row exclusive mode;
 if p_operation='add' then
   if p_expected is not null and p_expected<>'null'::jsonb then raise exception 'Invalid new contact snapshot';end if;
   if p_kind='spouse' and exists(select 1 from public.contacts where client_intake_id=v_intake_id and relationship_type='spouse') then raise exception 'A spouse already exists. Reopen the questionnaire.';end if;
   if exists(select 1 from public.contacts where client_intake_id=v_intake_id and merged_into_id is null and lower(btrim(first_name))=lower(btrim(p_patch->>'first_name')) and lower(btrim(last_name))=lower(btrim(p_patch->>'last_name'))) then raise exception 'A contact with this name already exists. Review the existing contact.';end if;
   select * into revised from jsonb_populate_record(null::public.contacts,p_patch);
 else
   select * into person from public.contacts where id=p_contact_id for update;
   if not found or person.client_intake_id is distinct from v_intake_id or person.relationship_type is distinct from p_kind or person.merged_into_id is not null then raise exception 'Select a saved household contact from this questionnaire.';end if;
   select jsonb_object_agg(k,to_jsonb(person)->k) into snapshot from unnest(allowed) k;
   if snapshot is distinct from p_expected then raise exception using errcode='40001',message='The household contact changed. Reopen the questionnaire.';end if;
   select * into revised from jsonb_populate_record(person,p_patch);
 end if;
 if p_operation<>'remove' and (nullif(btrim(revised.first_name),'') is null or nullif(btrim(revised.last_name),'') is null) then raise exception 'Enter a first and last name.';end if;
 if p_patch ? 'citizenship_status' then revised.is_us_citizen:=case when revised.citizenship_status='us_citizen' then true when revised.citizenship_status in ('permanent_resident','nonresident_alien','non_us_unspecified') then false else null end;end if;
 if p_operation='remove' then
   if exists(select 1 from public.contact_roles where contact_id=p_contact_id) then raise exception 'Review this person''s appointments before removing them from the household.';end if;
   update public.contacts set relationship_type='other',source='client_intake_'||p_kind||'_removed' where id=p_contact_id;
   update public.matter_contacts set relationship_type='other' where contact_id=p_contact_id and matter_id=any(matter_ids);
 elsif p_operation='add' then
   insert into public.contacts(id,client_intake_id,relationship_type,relationship_label,source,first_name,middle_name,last_name,suffix,preferred_pronoun,email,phone,address_line1,address_line2,city,state,zip,date_of_birth,preferred_name,prior_names,citizenship_status,is_us_citizen,child_relationship,parentage)
   values(p_contact_id,v_intake_id,p_kind,initcap(p_kind),'attorney_intake',revised.first_name,revised.middle_name,revised.last_name,revised.suffix,revised.preferred_pronoun,revised.email,revised.phone,revised.address_line1,revised.address_line2,revised.city,revised.state,revised.zip,revised.date_of_birth,revised.preferred_name,revised.prior_names,revised.citizenship_status,revised.is_us_citizen,revised.child_relationship,revised.parentage);
 else
   update public.contacts set first_name=revised.first_name,middle_name=revised.middle_name,last_name=revised.last_name,suffix=revised.suffix,preferred_pronoun=revised.preferred_pronoun,email=revised.email,phone=revised.phone,address_line1=revised.address_line1,address_line2=revised.address_line2,city=revised.city,state=revised.state,zip=revised.zip,date_of_birth=revised.date_of_birth,preferred_name=revised.preferred_name,prior_names=revised.prior_names,citizenship_status=revised.citizenship_status,is_us_citizen=revised.is_us_citizen,child_relationship=revised.child_relationship,parentage=revised.parentage where id=p_contact_id;
 end if;
 if p_operation<>'remove' and cardinality(matter_ids)=1 then
   insert into public.matter_contacts(matter_id,contact_id,relationship_type,relationship_label,child_relationship,parentage)
   values(matter_ids[1],p_contact_id,p_kind,initcap(p_kind),revised.child_relationship,revised.parentage)
   on conflict(matter_id,contact_id) do update set relationship_type=excluded.relationship_type,child_relationship=excluded.child_relationship,parentage=excluded.parentage;
 end if;
 if p_kind='child' then
   select coalesce(jsonb_agg(jsonb_build_object('name',concat_ws(' ',c.first_name,c.last_name),'dob',c.date_of_birth,
     'gender',c.gender,'deceased',coalesce(c.deceased,false),'relationship',coalesce(c.child_relationship,'biological'),
     'parentage',c.parentage,'is_minor',coalesce(c.is_minor,c.date_of_birth>(current_date-interval '18 years')::date,false)) order by c.id),'[]'::jsonb)
   into child_projection from public.contacts c where c.client_intake_id=v_intake_id and c.relationship_type='child' and c.merged_into_id is null;
   update public.design_sheets set children=child_projection,decisions=coalesce(decisions,'{}'::jsonb)||jsonb_build_object('children',child_projection),updated_at=clock_timestamp()
     where id=(select id from public.design_sheets where client_intake_id=v_intake_id order by version desc limit 1);
 end if;
 update public.client_intake set fiduciary_entries=coalesce(fiduciary_entries,'{}'::jsonb)-case when p_kind='child' then 'children' else 'spouse' end,updated_at=clock_timestamp() where id=v_intake_id;
end;
$$;
revoke all on function public.edit_pinned_intake_household(text,uuid,timestamptz,text,text,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.edit_pinned_intake_household(text,uuid,timestamptz,text,text,uuid,jsonb,jsonb) to service_role;
