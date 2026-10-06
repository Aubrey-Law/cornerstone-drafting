-- Mercury deposits recorded as invoice payments.
--
-- A daily run reads settled Mercury deposits, matches each to the open invoice
-- it pays, and offers the payment through the delegation dial
-- (billing.payment.record). An exact match (the amount equals the invoice's
-- balance and the sender's memo names the invoice) may be recorded up to Act
-- and report; anything less waits on Today.
--
-- The payment carries `mercury:<transaction id>` as its external reference.
-- Until now nothing in the database stopped one deposit being recorded twice:
-- the reference was free text checked only by the reader. record_invoice_payment
-- writes one billing_payments row per charge it pays, all with the same
-- reference, so uniqueness is per (reference, charge): a second recording of the
-- same deposit collides on its first charge and the whole call rolls back.
-- Scoped to Mercury references so nothing already in the ledger is affected
-- (no row carries one when this runs).

create unique index if not exists billing_payments_mercury_reference_uidx
  on public.billing_payments (external_reference, billing_item_id)
  where external_reference like 'mercury:%';

insert into public.automation_rules (
  name, description, trigger_key, action_key, mode, approval_policy,
  system_key, origin, schedule_cron, schedule_timezone, locked
)
values
  ('Mercury deposit matching', 'Each morning, reads the last two weeks of settled Mercury deposits, matches each to the open invoice it pays, and offers the payment through the delegation dial. Only an exact match (amount equals the balance and the memo names the invoice) can record without approval.', 'schedule', 'system_job', 'live', 'automatic', 'system:mercury-deposits', 'system_schedule', '35 11 * * *', 'UTC', true)
on conflict (system_key) do update set
  name = excluded.name, description = excluded.description, trigger_key = excluded.trigger_key,
  action_key = excluded.action_key, origin = excluded.origin, schedule_cron = excluded.schedule_cron,
  schedule_timezone = excluded.schedule_timezone, locked = excluded.locked;

notify pgrst, 'reload schema';
