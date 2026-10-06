# Mercury deposits recorded as payments

The Billing page's **Bank deposits** card has matched Mercury deposits to open invoices since
Phase 1 (`docs/integrations/mercury-bank-reconciliation.md`), but it only ever proposed: every
payment was still keyed in by hand. This slice records them through the delegation dial.

## The daily run

**Mercury deposit matching** (`/api/cron/mercury-deposits`, system automation
`mercury-deposits`, daily at 7:35 AM Eastern, before the daily digest) reads the last 14 days
of Mercury transactions with the same loader and matcher as the card, then sorts every deposit
the matcher could place into one of two tiers (`planDepositPayments`,
`lib/integrations/mercury/autoApply.ts`):

| Tier | When | How far the dial may take it |
|---|---|---|
| **Exact** | The amount equals one open invoice's balance **and** the sender's memo (Mercury's `externalMemo` and `note`, or the bank description) names that invoice's number and no other. | Up to **Act and report** |
| **Likely** | The matcher found one clear winner whose balance equals the amount (usually with the payer's name matching), but the memo does not name it. | **Propose** only, whatever the dial says |

A memo can settle what the amount cannot: two open invoices for the same flat fee are a tie the
matcher will not break, but a deposit whose memo says `2026-0013` is exact for that one.

Left on the card for a person, never offered: a near-tie with no memo, a memo naming an invoice
the amount does not settle (or naming two), two deposits reaching for one invoice, a deposit
posted well before the invoice was issued, pending deposits, and everything the matcher already
ignores (other accounts, internal transfers, card activity, Mercury's own credits).

Each offer is `billing.payment.record` (group Billing), keyed to `mercury:<transaction id>`, so
a deposit is offered once however many mornings the run sees it.

## Recording

Approving the card on Today, or the dial acting on an exact match, runs
`recordDepositPayment` (`lib/integrations/mercury/autoApplyServer.ts`), which checks again
before it writes:

1. Already recorded under the same reference → nothing happens.
2. **Re-reads the deposit from Mercury.** A different amount, or a deposit that is now pending,
   reversed, in another account or otherwise not a client payment, is refused.
3. **Re-reads the invoice.** It must still be issued or partly paid with at least the deposit's
   amount owing (after credits and adjustments).
4. Records through `record_invoice_payment` (method ACH, or Check for a check deposit; received
   at the deposit's posted time; note "Mercury deposit from …; memo: …"), which allocates across
   the invoice's charges oldest first. An invoice paid in full gets the usual `invoice_paid`
   entry on the matter timeline.

The migration adds a unique index on `billing_payments (external_reference, billing_item_id)`
for Mercury references, so two runs racing on one deposit cannot both post it.

**There is no undo.** The ledger has no "unrecord a payment"; a wrong one is corrected the way a
hand-keyed mistake is today. That is why the dial starts at Propose.

## Switching it on

1. Mercury must be configured (`MERCURY_API_TOKEN`, `MERCURY_INCOME_ACCOUNT_IDS`); without it the
   run does nothing and reports `configured: false`. A read-only token is enough: recording
   writes to Cornerstone's ledger, not to Mercury.
2. Run the migration `20270120090000_mercury_deposit_payments.sql`.
3. For a while, approve each card on Today and compare it with Mercury and the invoice.
4. When the exact matches read right, raise **Record a Mercury deposit as a payment** on the
   dial (Settings → Workflow → Delegation) to Act and report. Exact matches then record on
   their own and appear in "Done for you"; likely matches still wait. Act silently is clamped
   to Act and report.

Pause or dry-run the run from the Automation center.

## A decision this changes

The Mercury integration doc recorded the posture **"Propose, human confirms. Never auto-post."**
This slice keeps Propose as the default and adds the option to let exact, memo-confirmed
matches post. Raising the dial is the moment that decision changes, and it is the firm's to
make.
