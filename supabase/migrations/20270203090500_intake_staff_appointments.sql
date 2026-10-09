-- Staff authorizes and checks the active pinned block before calling.
-- A single slot changes atomically; other roles and contact facts are retained.
create or replace function public.edit_pinned_intake_appointment(
 p_intake_id text, p_version_id uuid, p_updated_at timestamptz, p_matter_id uuid,
 p_role text, p_party text, p_priority integer, p_coagent boolean,
 p_contact_id uuid, p_expected jsonb
) returns void language plpgsql security invoker set search_path='' as $$
declare
  v_intake_id public.client_intake.id%type;
 intake public.client_intake%rowtype;
 matter_ids uuid[];
 actual jsonb;
 existing_id uuid;
begin
  v_intake_id := p_intake_id;
 if p_role is null or p_role not in ('trustee','personal_rep','poa','hcp','guardian')
   or p_party is null or p_party not in ('client','spouse')
   or p_priority is null or p_priority not between 1 and 10 or p_coagent is null
   or jsonb_typeof(p_expected) is distinct from 'array' or jsonb_array_length(p_expected)>1 then
   raise exception using errcode='22023',message='Invalid appointment edit.';
 end if;
 -- Match merge's matter-before-intake order, and reject relinked/ambiguous scope.
 select coalesce(array_agg(m.id order by m.id),array[]::uuid[]) into matter_ids
 from (select id from public.matters where client_intake_id=v_intake_id order by id for share) m;
 if cardinality(matter_ids)>1 or matter_ids[1] is distinct from p_matter_id then
   raise exception using errcode='40001',message='The matter link changed. Reopen the questionnaire.';
 end if;
 select * into intake from public.client_intake where id=v_intake_id for update;
 if not found or intake.form_version_id is null or intake.form_version_id is distinct from p_version_id
   or intake.updated_at is distinct from p_updated_at or intake.status in ('submitted','approved') then
   raise exception using errcode='40001',message='The questionnaire changed. Close and reopen the intake before editing.';
 end if;
 if matter_ids is distinct from (select coalesce(array_agg(id order by id),array[]::uuid[]) from public.matters where client_intake_id=v_intake_id) then
   raise exception using errcode='40001',message='The matter link changed. Reopen the questionnaire.';
 end if;
 if p_contact_id is not null then
   perform 1 from public.contacts c where c.id=p_contact_id and c.merged_into_id is null
     and c.source is distinct from 'client_intake_additional_removed'
     and (case when p_matter_id is null then c.client_intake_id=v_intake_id
       else exists(select 1 from public.matter_contacts mc where mc.matter_id=p_matter_id and mc.contact_id=c.id) end)
     for update;
   if not found then raise exception using errcode='22023',message='Choose a current contact belonging to this matter.'; end if;
   if p_matter_id is not null then
     perform 1 from public.matter_contacts where matter_id=p_matter_id and contact_id=p_contact_id for share;
     if not found then raise exception using errcode='40001',message='The contact membership changed.'; end if;
   end if;
 end if;
 -- Legacy writers do not take the intake lock. This short table lock also
 -- protects empty slots against concurrent inserts and snapshot comparisons.
 lock table public.contact_roles in share row exclusive mode;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'contact_id',r.contact_id,'role',r.role,
   'for_party',r.for_party,'priority',r.priority,'is_coagent',r.is_coagent) order by r.id),'[]'::jsonb)
 into actual from public.contact_roles r where
   (case when p_matter_id is null then r.matter_id is null and r.client_intake_id=v_intake_id else r.matter_id=p_matter_id end)
   and r.role=p_role and r.for_party=p_party and r.priority=p_priority and r.is_coagent=p_coagent;
 if actual is distinct from p_expected then
   raise exception using errcode='40001',message='The appointment changed. Close and reopen the intake before editing.';
 end if;
 existing_id := (actual->0->>'id')::uuid;
 if p_contact_id is null then
   delete from public.contact_roles where id=existing_id;
 elsif existing_id is null then
   insert into public.contact_roles(contact_id,client_intake_id,matter_id,role,for_party,priority,is_coagent)
   values(p_contact_id,v_intake_id,p_matter_id,p_role,p_party,p_priority,p_coagent);
 else
   update public.contact_roles set contact_id=p_contact_id where id=existing_id;
 end if;
 -- Empty role slots must not be resurrected from historical JSON on reload.
 update public.client_intake set
   fiduciary_entries=coalesce(fiduciary_entries,'{}'::jsonb)-('fid_'||p_role||'_'||p_party),
   updated_at=clock_timestamp() where id=v_intake_id;
end;
$$;
revoke all on function public.edit_pinned_intake_appointment(text,uuid,timestamptz,uuid,text,text,integer,boolean,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.edit_pinned_intake_appointment(text,uuid,timestamptz,uuid,text,text,integer,boolean,uuid,jsonb) to service_role;
