-- Delegation dial: how far the assistant may act on its own, per action.
--
-- Every write already passes through action_proposals and action_executions.
-- Until now the only question a proposal could ask was "which confirmation does
-- this risk level need". The dial adds a firm-wide answer per action key:
--
--   observe      record what would have been done; create no pending card
--   propose      today's behavior: a pending card the attorney accepts
--   act_report   execute at once and list it in the morning digest and Today
--   act_silent   execute at once; the audit row is the only trace
--
-- The dial is consulted only by unattended callers (automation rules, and any
-- future unattended flow that opts in). A human click keeps its meaning. The
-- ceiling per risk level is enforced in code and repeated on the settings page:
-- legal_financial actions never pass "propose", external writes never pass
-- "act_report", prohibited actions never leave "observe".

create table public.action_autonomy_settings (
  action_key text primary key check (length(btrim(action_key)) between 3 and 120),
  autonomy text not null
    check (autonomy in ('observe', 'propose', 'act_report', 'act_silent')),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create trigger set_updated_at_action_autonomy_settings
before update on public.action_autonomy_settings
for each row execute function public.set_updated_at();

-- Written only by the server-side action service, like action_proposals.
alter table public.action_autonomy_settings enable row level security;
revoke all on table public.action_autonomy_settings from anon, authenticated;

-- Which dial position produced a proposal. Default keeps every existing row
-- and every human-initiated proposal at today's meaning.
alter table public.action_proposals
  add column autonomy text not null default 'propose'
    check (autonomy in ('observe', 'propose', 'act_report', 'act_silent'));

grant select (autonomy) on table public.action_proposals to authenticated;

-- "observed" is terminal: the dial said look but do not touch. The claim RPC
-- already refuses anything that is not pending, so an observed proposal can
-- never be executed later by accident.
alter table public.action_proposals
  drop constraint if exists action_proposals_status_check;
alter table public.action_proposals
  add constraint action_proposals_status_check
    check (status in ('pending', 'accepted', 'rejected', 'expired', 'executed', 'failed', 'observed'));

create index action_proposals_delegated_idx
  on public.action_proposals (created_at desc)
  where autonomy = 'act_report' or status = 'observed';

-- An execution the attorney reversed from the digest or Today. The side effect
-- is undone by the action's own inverse; the row keeps its before/after audit.
alter table public.action_executions
  drop constraint if exists action_executions_status_check;
alter table public.action_executions
  add constraint action_executions_status_check
    check (status in ('running', 'succeeded', 'failed', 'undone'));
alter table public.action_executions
  add column undone_at timestamptz,
  add column undone_by uuid references auth.users(id) on delete set null;

comment on table public.action_autonomy_settings is
  'Delegation dial: per action key, how far unattended callers may act without a person. Absent row means propose.';
comment on column public.action_proposals.autonomy is
  'Dial position that produced this proposal. Human-initiated proposals stay at propose.';
comment on column public.action_executions.undone_at is
  'Set when the attorney reversed this execution through the action''s inverse.';
