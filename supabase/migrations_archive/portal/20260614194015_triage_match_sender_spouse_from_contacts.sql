/*
  # Repoint triage_match_sender's spouse-email match to contacts

  triage_match_sender(p_email) matches an inbound email sender to a client or
  lead. Its client branch matched on `ci.email` OR `ci.spouse_email`. The
  client_intake.spouse_* columns are being dropped (contacts is the sole source
  of spouse data), so the spouse-email match must come from the spouse contact
  instead. The leads branch keeps `l.spouse_email` (leads.spouse_* is retained).

  This function previously existed ONLY in production (created via the SQL editor;
  not tracked in a migration). This migration brings it under version control with
  the contacts-based lookup. Apply BEFORE 20260614130000_drop_client_intake_spouse_columns
  or the function breaks at runtime on the dropped column.

  CREATE OR REPLACE — idempotent, no dependency drop needed.
*/

CREATE OR REPLACE FUNCTION public.triage_match_sender(p_email text)
 RETURNS TABLE(kind text, display_name text, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare e text := lower(trim(coalesce(p_email, '')));
begin
  if e = '' then
    return;
  end if;

  return query
    select 'client'::text,
           coalesce(nullif(trim(ci.full_name), ''),
                    nullif(trim(concat_ws(' ', ci.first_name, ci.last_name)), '')),
           ci.status
    from client_intake ci
    where lower(ci.email) = e
       or exists (
            select 1 from contacts sc
            where sc.client_intake_id = ci.id
              and sc.relationship_type = 'spouse'
              and lower(sc.email) = e
          )
    limit 1;
  if found then
    return;
  end if;

  return query
    select 'lead'::text,
           nullif(trim(concat_ws(' ', l.first_name, l.last_name)), ''),
           l.status
    from leads l
    where l.deleted_at is null
      and (lower(l.email) = e or lower(l.spouse_email) = e)
    limit 1;
end;
$function$;
