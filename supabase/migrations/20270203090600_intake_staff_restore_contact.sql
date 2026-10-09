create or replace function public.restore_pinned_intake_contact(
 p_intake_id text,p_version_id uuid,p_updated_at timestamptz,p_contact_id uuid,p_expected jsonb
) returns void language plpgsql security invoker set search_path='' as $$
declare
  v_intake_id public.client_intake.id%type;
 intake public.client_intake%rowtype;
 person public.contacts%rowtype;
 snapshot jsonb;
 allowed text[]:=array['first_name','middle_name','last_name','suffix','preferred_pronoun','email','phone','address_line1','address_line2','city','state','zip'];
begin
  v_intake_id := p_intake_id;
 select * into intake from public.client_intake where id=v_intake_id for update;
 if not found or intake.form_version_id is null or intake.form_version_id is distinct from p_version_id
   or intake.updated_at is distinct from p_updated_at or intake.status in ('submitted','approved') then
   raise exception using errcode='40001',message='The questionnaire changed. Close and reopen the intake before editing.';
 end if;
 select * into person from public.contacts where id=p_contact_id for update;
 if not found or person.client_intake_id is distinct from v_intake_id or person.source is distinct from 'client_intake_additional_removed' or person.merged_into_id is not null then
   raise exception using errcode='22023',message='Select a retained contact from this questionnaire.';
 end if;
 select jsonb_object_agg(k,to_jsonb(person)->k) into snapshot from unnest(allowed) k;
 if snapshot is distinct from p_expected then raise exception using errcode='40001',message='The contact changed. Reopen the questionnaire.';end if;
 update public.contacts set source='client_intake_additional' where id=p_contact_id;
 update public.client_intake set updated_at=clock_timestamp() where id=v_intake_id;
end;
$$;
revoke all on function public.restore_pinned_intake_contact(text,uuid,timestamptz,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.restore_pinned_intake_contact(text,uuid,timestamptz,uuid,jsonb) to service_role;
