# Time entries

The ledger knows what was billed and what was paid, but not what the work took. Flat-fee and
legal-plan matters are not billed by the hour, yet the firm still wants the hours: they are how
it learns which matters pay. Time is recorded here, in whole minutes and shown in tenths of an
hour. It is **not invoiced**; nothing in this slice touches `billing_items`.

## On the matter page

Matter → Billing → **Time** card (right column, above Plan claims):

- **Start timer** with an optional note. The timer lives in `time_entry_timers`, one row per
  person, so a timer started on the desk is still running on the phone. Starting a timer on
  another matter stops the first and logs its time.
- **Stop and log** writes an entry for the time run, rounded up to the next tenth (at least
  0.1 h, at most 24 h), dated the day the timer started. The ✕ discards a timer without
  logging it, after a confirmation.
- **Add time** takes the time as hours (`1.5`, `.3`, `2h`), hours and minutes (`1:30`) or
  minutes (`45m`), a date and what was done.
- Each entry shows its date, its source (timer, suggested, or typed) and can be removed.

Routes (staff only, `requireAdmin`): `GET|POST /api/admin/matters/[id]/time-entries`,
`DELETE /api/admin/matters/[id]/time-entries/[entryId]`,
`POST|DELETE /api/admin/matters/[id]/time-entries/timer` (`?discard=1` throws the timer away).

## Suggested entries

**Time entry suggestions** (`/api/cron/time-entry-suggestions`, system automation
`time-entry-suggestions`, daily at 8:50 AM Eastern) reads the previous firm-calendar day:

- `matter_activity` rows a person did (`actor_id` set): email sent and text sent 0.1 h each,
  note written, intake sent, task completed, document filed, invoice issued 0.1 h each, draft
  reviewed 0.2 h, documents drafted 0.5 h. Views, stage moves, flags and inbound texts are not
  work and suggest nothing. The figures are in `ACTIVITY_MINUTES` (`lib/timeEntries/model.ts`)
  and are deliberately modest: easy to accept, easy to raise.
- `appointments` linked to a matter, still `scheduled`, that have ended: the meeting's length.

It offers **one entry per matter** through the delegation dial as `billing.time_entry.create`
(group Billing, risk internal write), with a description listing what was counted ("Meeting:
Marcus Chen (1.0 h); Email sent (2); Documents drafted"). A matter with **any** time already
logged that day is skipped: whoever logged it was keeping time by hand. The proposal and the
entry both carry `time-suggestion:<matter>:<day>`; the idempotency key stops a second proposal
and the unique `suggestion_key` stops a second entry, so a re-run never stacks.

At **Propose** (the default) each suggestion waits as a card on Today showing the matter, the
date, the time and the description. Raise the action on the dial (Settings → Workflow →
Delegation) to Act and report or Act silently once the figures read right; an entry the dial
made on its own can be undone from the "Done for you" card on Today, which removes it. Pause
the run or dry-run it from the Automation center.

## Schema

Migration `20270119090000_time_entries.sql`:

- `time_entries`: `matter_id`, `user_id`, `work_date`, `minutes` (1–1440), `description`,
  `source` (`timer` | `manual` | `suggested`), `activity_ids`, `suggestion_key` (unique),
  `created_by`, `created_at`. Staff RLS (attorney, admin).
- `time_entry_timers`: `user_id` (primary key), `matter_id`, `started_at`, `description`. RLS
  limits each person to their own row; the routes use the service role.
- The `system:time-entry-suggestions` row in `automation_rules`.

The app deploys before the migration: the card says time arrives with the next database update
and the suggestion run reports itself unavailable (503) until the tables exist.

## Not yet

- No hourly rate, so no value or profitability figure. A rate on `firm_settings` (and per
  matter) is the natural next step, and the trust ledger and QuickBooks slices will want it.
- Entries cannot be edited, only removed and re-entered.
- Phone calls (`calls`) carry no matter, so they suggest nothing.
