-- Service action verifies the active pinned block. Removal retains the directory
-- record and every matter membership; it never cascades through appointments.
create or replace function public.change_pinned_intake_contact_membership(
  p_intake_id text, p_version_id uuid, p_updated_at timestamptz,
  p_operation text, p_contact_id uuid, p_expected jsonb, p_patch jsonb
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_intake_id public.client_intake.id%type;
  intake public.client_intake%rowtype;
  person public.contacts%rowtype;
  snapshot jsonb;
  matter_ids uuid[];
  current_matter_ids uuid[];
  allowed text[] := array['first_name','middle_name','last_name','suffix','preferred_pronoun',
    'email','phone','address_line1','address_line2','city','state','zip'];
begin
  v_intake_id := p_intake_id;
  if p_operation is null or p_operation not in ('add','remove')
    or jsonb_typeof(p_patch) is distinct from 'object' or jsonb_typeof(p_expected) is distinct from 'object' then
    raise exception using errcode='22023',message='Invalid contact operation.';
  end if;
  -- Match the existing matter-before-intake lock order used by matter merging.
  if p_operation='add' then
    select coalesce(array_agg(m.id order by m.id),array[]::uuid[]) into matter_ids
      from (select id from public.matters where client_intake_id=v_intake_id order by id for share) m;
  end if;
  select * into intake from public.client_intake where id=v_intake_id for update;
  if not found or intake.form_version_id is null or intake.form_version_id is distinct from p_version_id
    or intake.updated_at is distinct from p_updated_at or intake.status in ('submitted','approved') then
    raise exception using errcode='40001',message='The questionnaire changed. Close and reopen the intake before editing.';
  end if;
  if p_operation='add' then
    select coalesce(array_agg(id order by id),array[]::uuid[]) into current_matter_ids from public.matters where client_intake_id=v_intake_id;
    if matter_ids is distinct from current_matter_ids or cardinality(matter_ids)>1 then
      raise exception using errcode='40001',message='The intake matter link needs review before adding a contact.';
    end if;
    if p_expected <> '{}'::jsonb or exists(select 1 from jsonb_each(p_patch) e
      where not (e.key=any(allowed || array['relationship_label'])) or jsonb_typeof(e.value) not in ('string','null') or length(e.value #>> '{}')>2000) then
      raise exception using errcode='22023',message='Invalid contact fields.';
    end if;
    select * into person from jsonb_populate_record(null::public.contacts,p_patch);
    if nullif(btrim(person.first_name),'') is null or nullif(btrim(person.last_name),'') is null then
      raise exception using errcode='22023',message='Enter a first and last name for the contact.';
    end if;
    if exists(select 1 from public.contacts where client_intake_id=v_intake_id and merged_into_id is null
      and lower(btrim(first_name))=lower(btrim(person.first_name)) and lower(btrim(last_name))=lower(btrim(person.last_name))) then
      raise exception using errcode='22023',message='A contact with this name already exists for this intake. Review the existing contact before adding another.';
    end if;
    insert into public.contacts(id,client_intake_id,source,relationship_type,relationship_label,
      first_name,middle_name,last_name,suffix,preferred_pronoun,email,phone,address_line1,address_line2,city,state,zip)
    values(p_contact_id,v_intake_id,'client_intake_additional','other',person.relationship_label,
      btrim(person.first_name),person.middle_name,btrim(person.last_name),person.suffix,person.preferred_pronoun,
      person.email,person.phone,person.address_line1,person.address_line2,person.city,person.state,person.zip);
    if cardinality(matter_ids)=1 then
      insert into public.matter_contacts(matter_id,contact_id,relationship_type,relationship_label)
        values(matter_ids[1],p_contact_id,'other',person.relationship_label) on conflict(matter_id,contact_id) do nothing;
    end if;
  else
    if p_patch <> '{}'::jsonb then raise exception using errcode='22023',message='Removal cannot change contact details.'; end if;
    select * into person from public.contacts where id=p_contact_id for update;
    if not found or person.client_intake_id is distinct from v_intake_id or person.source is distinct from 'client_intake_additional' or person.merged_into_id is not null then
      raise exception using errcode='22023',message='Contact does not belong to this intake contact list.';
    end if;
    select jsonb_object_agg(k,to_jsonb(person)->k) into snapshot from unnest(allowed) k;
    if snapshot is distinct from p_expected then raise exception using errcode='40001',message='The contact changed. Close and reopen the intake before removing it.'; end if;
    if exists(select 1 from public.contact_roles where contact_id=p_contact_id) then
      raise exception using errcode='22023',message='This contact holds an appointment. Review those appointments before removing the contact from the questionnaire.';
    end if;
    update public.contacts set source='client_intake_additional_removed' where id=p_contact_id;
  end if;
  update public.client_intake set updated_at=clock_timestamp() where id=v_intake_id;
end;
$$;
revoke all on function public.change_pinned_intake_contact_membership(text,uuid,timestamptz,text,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.change_pinned_intake_contact_membership(text,uuid,timestamptz,text,uuid,jsonb,jsonb) to service_role;
