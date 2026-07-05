-- ============================================================
-- MATTER ATTENTION SECTION — SUPABASE SCHEMA
-- Aubrey Law Portal
-- ============================================================


-- ── ENUMS ────────────────────────────────────────────────────

create type alert_severity as enum (
  'blocker',   -- hard stage-gate: advance button disabled
  'warning',   -- action needed but not blocking
  'info'       -- FYI / missing doc
);

create type alert_source as enum (
  'ai_intake', -- Claude ran against intake and flagged this
  'system',    -- rule-based stage-gate check
  'manual'     -- attorney added manually
);

create type flag_category as enum (
  'tax',       -- threshold-based: estate value, MA estate tax
  'family',    -- detected from intake: minors, blended, SN
  'asset',     -- detected from asset inventory: real property, biz, retirement
  'attorney'   -- manually added by attorney during consultation
);


-- ── MATTER ALERTS ─────────────────────────────────────────────

create table matter_alerts (
  id              uuid primary key default gen_random_uuid(),
  matter_id       uuid not null references matters(id) on delete cascade,
  severity        alert_severity not null default 'warning',
  source          alert_source not null,
  title           text not null,
  detail          text,
  is_resolved     boolean not null default false,
  resolved_at     timestamptz,
  resolved_by     uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index matter_alerts_active_idx
  on matter_alerts(matter_id)
  where is_resolved = false;


-- ── MATTER FLAGS ──────────────────────────────────────────────

create table matter_flags (
  id              uuid primary key default gen_random_uuid(),
  matter_id       uuid not null references matters(id) on delete cascade,
  category        flag_category not null,
  label           text not null,
  is_auto         boolean not null default true,
  added_by        uuid references auth.users(id),
  created_at      timestamptz not null default now()
);

create index matter_flags_matter_idx on matter_flags(matter_id);


-- ── MATTER STAGE RULES ────────────────────────────────────────

create table matter_stage_rules (
  id              uuid primary key default gen_random_uuid(),
  from_stage      text not null,
  to_stage        text not null,
  rule_key        text not null,
  description     text not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (from_stage, rule_key)
);

insert into matter_stage_rules (from_stage, to_stage, rule_key, description) values
  ('lead',                    'consultation_scheduled', 'intake_submitted',           'Client must submit intake form before consultation is scheduled'),
  ('consultation_scheduled',  'peace_of_mind_held',     'consultation_confirmed',     'Consultation must be confirmed on calendar'),
  ('peace_of_mind_held',      'hired',                  'engagement_agreement_signed','Engagement agreement must be signed via DocuSign before matter is hired'),
  ('hired',                   'design_session',         'deposit_received',           'Initial deposit must be recorded before Design Session'),
  ('design_session',          'drafting',               'design_sheet_complete',      'Design sheet must be marked complete before Drafting begins'),
  ('drafting',                'client_review',          'documents_generated',        'At least one document set must be generated before Client Review'),
  ('client_review',           'execution_signing',      'client_approved_drafts',     'Client must approve drafts before Signing is scheduled'),
  ('execution_signing',       'closed',                 'all_documents_signed',       'All execution documents must be signed before matter is closed');


-- ── RLS POLICIES ─────────────────────────────────────────────

alter table matter_alerts      enable row level security;
alter table matter_flags       enable row level security;
alter table matter_stage_rules enable row level security;

-- Attorney check: matches pattern used across this project
create policy "attorneys_full_access_alerts"
  on matter_alerts for all
  using (
    (select email from auth.users where id = auth.uid()) = 'scott@aubreylegal.com'
  )
  with check (
    (select email from auth.users where id = auth.uid()) = 'scott@aubreylegal.com'
  );

create policy "attorneys_full_access_flags"
  on matter_flags for all
  using (
    (select email from auth.users where id = auth.uid()) = 'scott@aubreylegal.com'
  )
  with check (
    (select email from auth.users where id = auth.uid()) = 'scott@aubreylegal.com'
  );

create policy "attorneys_read_stage_rules"
  on matter_stage_rules for select
  using (
    (select email from auth.users where id = auth.uid()) = 'scott@aubreylegal.com'
  );


-- ── HELPER FUNCTION: resolve alert ───────────────────────────

create or replace function resolve_alert(
  p_alert_id uuid,
  p_user_id  uuid
) returns void
language plpgsql security definer as $$
begin
  update matter_alerts
  set
    is_resolved = true,
    resolved_at = now(),
    resolved_by = p_user_id
  where id = p_alert_id;
end;
$$;


-- ── HELPER FUNCTION: run stage-gate check ────────────────────

create or replace function check_stage_gates(
  p_matter_id uuid,
  p_from_stage text
) returns table (
  rule_key    text,
  description text
)
language plpgsql security definer as $$
begin
  return query
  select r.rule_key, r.description
  from matter_stage_rules r
  where r.from_stage = p_from_stage
    and r.is_active = true
    and not exists (
      select 1
      from matter_alerts a
      where a.matter_id = p_matter_id
        and a.source = 'system'
        and a.is_resolved = true
        and a.title ilike '%' || r.rule_key || '%'
    );
end;
$$;
