-- Lead notes gain the Internal / Client comm. split the matter file has had
-- since 20260705000001. Until now every lead note was internal by definition —
-- the timeline titled them all "Internal note" — so a call logged for the
-- client record read the same as a private reminder.
--
-- Existing rows are internal, which is what they have always been.
alter table public.lead_notes add column if not exists note_type text not null default 'internal';
alter table public.lead_notes drop constraint if exists lead_notes_note_type_check;
alter table public.lead_notes add constraint lead_notes_note_type_check check (note_type in ('internal','client_comm'));

-- Both note RPCs take the type. They are dropped and recreated rather than
-- overloaded: an overload would leave the old three-argument version callable,
-- and a caller that forgot the type would silently write an internal note.
drop function if exists public.create_lead_note_with_activity(uuid,text,uuid);
create function public.create_lead_note_with_activity(p_lead_id uuid,p_body text,p_actor_id uuid,p_note_type text default 'internal') returns public.lead_notes language plpgsql security definer set search_path=pg_catalog,public as $$ declare v public.lead_notes; begin perform public.assert_lead_note_actor(p_actor_id); if p_note_type is not null and p_note_type not in ('internal','client_comm') then raise exception 'Unknown note type' using errcode='22023'; end if; insert into public.lead_notes(lead_id,body,actor_id,note_type) values(p_lead_id,trim(p_body),p_actor_id,coalesce(p_note_type,'internal')) returning * into v; insert into public.lead_activity(lead_id,event_type,title,detail,actor_id) values(p_lead_id,'note_added','Note added',v.body,p_actor_id); return v; end $$;

-- A null type on update leaves the note's own type alone, so an edit that only
-- changes the body cannot quietly reclassify the note.
drop function if exists public.update_lead_note_with_activity(uuid,uuid,text,uuid);
create function public.update_lead_note_with_activity(p_lead_id uuid,p_note_id uuid,p_body text,p_actor_id uuid,p_note_type text default null) returns public.lead_notes language plpgsql security definer set search_path=pg_catalog,public as $$ declare v public.lead_notes; v_role text; begin v_role:=public.assert_lead_note_actor(p_actor_id); if p_note_type is not null and p_note_type not in ('internal','client_comm') then raise exception 'Unknown note type' using errcode='22023'; end if; select * into v from public.lead_notes where id=p_note_id and lead_id=p_lead_id; if not found then raise exception 'Note not found' using errcode='P0002'; end if; if v.actor_id<>p_actor_id and v_role<>'admin' then raise exception 'Forbidden' using errcode='42501'; end if; update public.lead_notes set body=trim(p_body),note_type=coalesce(p_note_type,note_type) where id=p_note_id returning * into v; insert into public.lead_activity(lead_id,event_type,title,actor_id) values(p_lead_id,'note_updated','Note updated',p_actor_id); return v; end $$;

revoke all on function public.create_lead_note_with_activity(uuid,text,uuid,text),public.update_lead_note_with_activity(uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.create_lead_note_with_activity(uuid,text,uuid,text),public.update_lead_note_with_activity(uuid,uuid,text,uuid,text) to service_role;
