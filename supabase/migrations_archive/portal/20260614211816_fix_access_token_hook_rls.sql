-- Fix: custom_access_token_hook caused a full auth outage (every /token request
-- 500'd with "permission denied for function is_attorney_or_staff").
--
-- Root cause: the hook runs as `supabase_auth_admin`, which does NOT have
-- BYPASSRLS (the original 20260511 migration wrongly assumed it did). Its
-- `SELECT u.role FROM public.users` therefore evaluates the RLS policies on
-- public.users, two of which call public.is_attorney_or_staff(). That function
-- does not grant EXECUTE to supabase_auth_admin, so policy evaluation throws
-- 42501 and the hook errors out, blocking all logins and token refreshes.
--
-- Fix: run the hook as SECURITY DEFINER (owner = postgres, which has BYPASSRLS)
-- so the role lookup bypasses RLS entirely and never touches is_attorney_or_staff.
-- search_path is locked to '' and every object is schema-qualified.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb;
  resolved_role text;
begin
  claims := event->'claims';

  select u.role into resolved_role
  from public.users u
  where u.id = (event->>'user_id')::uuid;

  if resolved_role is not null then
    claims := jsonb_set(claims, '{user_role}', to_jsonb(resolved_role));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- supabase_auth_admin must still be able to invoke the hook; keep prior grants.
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
