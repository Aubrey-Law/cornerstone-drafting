alter table public.firma_webhook_events
  add column if not exists processing_started_at timestamptz;

create or replace function public.claim_firma_webhook_event(
  p_event_id text,
  p_firma_request_id text,
  p_event_type text,
  p_payload jsonb,
  p_agreement_id uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  claim_status text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;
  if nullif(btrim(p_event_id), '') is null then
    raise exception 'event id required';
  end if;

  insert into public.firma_webhook_events (
    event_id,
    firma_request_id,
    event_type,
    payload,
    agreement_id,
    processing_started_at,
    error
  )
  values (
    p_event_id,
    p_firma_request_id,
    p_event_type,
    p_payload,
    p_agreement_id,
    statement_timestamp(),
    null
  )
  on conflict (event_id) do update
  set
    firma_request_id = excluded.firma_request_id,
    event_type = excluded.event_type,
    payload = excluded.payload,
    agreement_id = excluded.agreement_id,
    processing_started_at = statement_timestamp(),
    error = null
  where public.firma_webhook_events.processed_at is null
    and (
      public.firma_webhook_events.error is not null
      or public.firma_webhook_events.processing_started_at is null
      or public.firma_webhook_events.processing_started_at
        < statement_timestamp() - interval '5 minutes'
    )
  returning 'claimed' into claim_status;

  if claim_status is not null then
    return claim_status;
  end if;

  select case
    when processed_at is not null then 'duplicate'
    else 'in_progress'
  end
  into claim_status
  from public.firma_webhook_events
  where event_id = p_event_id;

  return coalesce(claim_status, 'in_progress');
end;
$$;

revoke execute on function public.claim_firma_webhook_event(text, text, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_firma_webhook_event(text, text, text, jsonb, uuid)
  to service_role;
