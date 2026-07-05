-- Custom Access Token Hook: inject `user_role` into the JWT claims so
-- requireAdmin / proxy.ts can read the role from the locally-verified token
-- instead of doing a `SELECT role FROM users` on every protected request.
--
-- After applying this migration, enable the hook in the Supabase Dashboard:
--   Authentication → Hooks → Custom Access Token Hook → Enable →
--   public.custom_access_token_hook
--
-- The claim is additive. Existing sessions that haven't been re-issued yet
-- will not have it, so consumers must fall back to a DB role lookup when
-- `user_role` is absent.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
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

-- Supabase Auth invokes hooks as the supabase_auth_admin role (which has
-- BYPASSRLS, so no policy is needed). Grant the minimum: execute on the
-- function and read on the columns it touches.
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

grant select (id, role) on public.users to supabase_auth_admin;
