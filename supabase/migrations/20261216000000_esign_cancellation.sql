-- A firm can withdraw a signature request, and the record says so.
--
-- Two CHECK constraints stand between the app and an honest cancellation.
--
-- esign_signing_sessions.status has no value for "withdrawn", so the only way
-- to close a live link today is to mark it `expired`. That is what the
-- engagement path does (lib/esign/native.ts), and it means a client who was
-- told to expect a document is told their link expired when it did not — the
-- firm took it back. The session row is also the only thing that closes a
-- link: the signing route finds a session by token hash alone and never reads
-- the parent request, so "cancelled" has to be expressible on the session or
-- cancelling is cosmetic.
--
-- esign_audit_events.event_type has no `cancelled` either, so a firm
-- cancellation is filed as `declined` with a flag in the detail. That line is
-- read back and printed onto the audit certificate of every document
-- subsequently sealed for that owner, where it reads as the client having
-- declined. It attributes an act of the firm to the person who did not do it,
-- on the one artifact that exists to be evidence.
--
-- Widening a CHECK is additive: every row that satisfied the old constraint
-- satisfies the new one. Dropped and recreated because Postgres has no
-- `alter constraint` for a check expression.
--
-- Nothing is backfilled. Rows already filed as `declined` keep that value —
-- the table is append-only by grant, and an audit row records what was written
-- at the time, not what the code would write today.

alter table public.esign_signing_sessions
  drop constraint if exists esign_signing_sessions_status_check;

alter table public.esign_signing_sessions
  add constraint esign_signing_sessions_status_check check (
    status in ('sent', 'viewed', 'signed', 'declined', 'expired', 'cancelled')
  );

alter table public.esign_audit_events
  drop constraint if exists esign_audit_events_event_type_check;

alter table public.esign_audit_events
  add constraint esign_audit_events_event_type_check check (
    event_type in (
      'sent', 'opened', 'consented', 'signed', 'declined', 'sealed', 'emailed',
      'cancelled'
    )
  );

comment on column public.esign_signing_sessions.status is
  'sent/viewed are open; signed/declined are outcomes; expired lapsed on its own; cancelled was withdrawn by the firm.';
