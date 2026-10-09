-- Staff server action authorizes and resolves the active pinned block first.
-- No insert/delete, identity reassignment, or appointment mutation is permitted.
create or replace function public.edit_pinned_intake_contact(
  p_intake_id text, p_version_id uuid, p_updated_at timestamptz,
  p_contact_id uuid, p_expected jsonb, p_patch jsonb
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_intake_id public.client_intake.id%type;
  intake public.client_intake%rowtype;
  person public.contacts%rowtype;
  revised public.contacts%rowtype;
  snapshot jsonb;
  allowed text[] := array['first_name','middle_name','last_name','suffix','preferred_pronoun',
    'email','phone','address_line1','address_line2','city','state','zip'];
begin
  v_intake_id := p_intake_id;
  if jsonb_typeof(p_patch) is distinct from 'object' or p_patch = '{}'::jsonb
    or jsonb_typeof(p_expected) is distinct from 'object' then
    raise exception using errcode='22023', message='Invalid contact edit.';
  end if;
  if exists(select 1 from jsonb_each(p_patch) e where not (e.key = any(allowed))
    or jsonb_typeof(e.value) not in ('string','null') or length(e.value #>> '{}') > 2000) then
    raise exception using errcode='22023', message='Invalid contact field.';
  end if;
  select * into intake from public.client_intake where id = v_intake_id for update;
  if not found or intake.form_version_id is null or intake.form_version_id is distinct from p_version_id
    or intake.updated_at is distinct from p_updated_at or intake.status in ('submitted','approved') then
    raise exception using errcode='40001', message='The questionnaire changed. Close and reopen the intake before editing.';
  end if;
  select * into person from public.contacts where id = p_contact_id for update;
  if not found or person.client_intake_id is distinct from v_intake_id
    or person.source is distinct from 'client_intake_additional' or person.merged_into_id is not null then
    raise exception using errcode='22023', message='Contact does not belong to this intake contact list.';
  end if;
  select jsonb_object_agg(k, to_jsonb(person)->k) into snapshot from unnest(allowed) k;
  if snapshot is distinct from p_expected then
    raise exception using errcode='40001', message='The contact changed. Close and reopen the intake before editing.';
  end if;
  select * into revised from jsonb_populate_record(person, p_patch);
  if nullif(btrim(revised.first_name),'') is null or nullif(btrim(revised.last_name),'') is null then
    raise exception using errcode='22023', message='A saved contact must have a first and last name.';
  end if;
  update public.contacts set first_name=revised.first_name, middle_name=revised.middle_name,
    last_name=revised.last_name, suffix=revised.suffix, preferred_pronoun=revised.preferred_pronoun,
    email=revised.email, phone=revised.phone, address_line1=revised.address_line1,
    address_line2=revised.address_line2, city=revised.city, state=revised.state, zip=revised.zip
  where id=p_contact_id;
  update public.client_intake set updated_at=clock_timestamp() where id=v_intake_id;
end;
$$;
revoke all on function public.edit_pinned_intake_contact(text,uuid,timestamptz,uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.edit_pinned_intake_contact(text,uuid,timestamptz,uuid,jsonb,jsonb) to service_role;
