# Weekly financial snapshot

Each Monday morning the firm gets one email with the week just ended, read from the ledger:
what came in, what went out, where receivables stand, and how the year is tracking against the
goal. The same figures are stored, one row per week, and shown on Billing → Reports with the
week-over-week change. Nothing here is a new source of truth; it is the Billing page's own
numbers, remembered and delivered.

## What runs

- **When.** Mondays at 8:10 AM Eastern (`/api/cron/weekly-financial-snapshot`, system
  automation `weekly-financial-snapshot`, paused or dry-run from the Automation center like
  the rest). "Send now" on the Reports card runs it on demand and re-sends.
- **Which week.** The last complete Monday-to-Sunday week before today
  (`lastCompleteWeek`). Run late in the week, it still reports the week that ended Sunday.
- **From what.** `fetchBillingData`, the loader behind Billing → Reports, so the email and
  the page agree. Receivables are read as of the Monday after.

The rules are in `lib/billing/weeklySnapshot.ts` (pure); `lib/billing/weeklySnapshotServer.ts`
stores, compares and sends.

## The figures

| Section | Figures |
|---|---|
| This week | Collected (payments received, with the count of distinct payments), billed (client charges invoiced and plan claims submitted), costs entered |
| Where things stand | Outstanding and open count, past due and count, aging (current, 31 to 60 days, over 60), client charges still to invoice, plan claims submitted and unpaid, plan claims still to submit |
| The year | Collected since January 1, percent of the annual goal, and the pace the goal implies by the week's last day (ahead or behind by how much) |

Week-over-week change is shown for collected, outstanding and past due. It compares against
the stored row for the week before; when there is none (the first run), collected compares
against the ledger's own prior-week payments.

## What is recorded

`billing_weekly_snapshots` (`20270118090000_weekly_financial_snapshot.sql`), one row per
`week_start`: the headline figures as typed columns, the whole snapshot in `metrics`, and the
email status and time. Aggregates only: no client names or per-matter amounts. Staff can read
it; only the service role writes. The unique week key makes a second run on the same Monday an
update that sends nothing (the row already carries `sent_at`); "Send now" is the exception.

The email uses the `weekly_financial_snapshot` category (internal) and goes to the firm's admin
address, like the daily digest. An email the kill switch or a category toggle keeps in leaves
the row stored with that status and no `sent_at`, so the next run tries again.

## The annual goal

`firm_settings.billing_annual_goal_cents` has been read by the Billing page since the start
but had no place to be changed. The Reports card now has a field for it (administrators), through
`PATCH /api/admin/settings/billing`. The Collection goal card and the snapshot both measure
against it.
