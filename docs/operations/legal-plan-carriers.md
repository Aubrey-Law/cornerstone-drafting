# Legal-plan carriers in the ledger

A matter's billing type has offered MetLife, LegalEASE, ARAG, Hyatt, LegalShield and "Other legal
plan" for a while, but the billing ledger knew only MetLife and LegalEASE. On an ARAG, Hyatt or
LegalShield matter:

- **Start a claim** opened Add charge with the plan set to MetLife, and the plan list offered
  only MetLife or LegalEASE, so the claim was filed under the wrong carrier.
- The matter's plan claims card, the Billing page's per-plan card and the carrier invoice left
  the claim out.
- No "claim not prepared" reminder appeared.

All five named plans are now carriers everywhere a carrier is listed.

## What changed

- `billingPlans` (`lib/billing/types.ts`) holds all five carriers. `billingPlanLabels` takes each
  name from the billing-type labels, so the two lists cannot drift. `billingPlanFor()` maps a
  matter's billing type, or its `legal_plan` display name, to a carrier.
- Invoice payers (`lib/billing/invoices.ts`) are the client plus every carrier. A carrier invoice
  is any invoice whose payer is not the client, so it is never emailed, shown in the portal,
  offered for checkout or reminded, whichever carrier it bills.
- The matter page, Add charge, the Billing rail and nudges, and the per-plan card read the same
  labels. **Start a claim** now defaults to the matter's own carrier.
- Migration `20270122090000_legal_plan_carriers.sql` widens `billing_items_plan_check` and
  `invoices_payer_check` to the same five. Widening a check leaves existing rows valid.

"Other legal plan" is still not a carrier. It names no one to bill, so a claim is recorded once
the firm knows which plan it is, by changing the matter's billing type.

## Not in this change

Only MetLife has a fee schedule, a claim document and a submission table (`lib/metlife/`, the
Prepare MetLife claim workflow). For the other four carriers, claims are entered by hand as a plan
claim with a label and an amount. Each carrier's fee schedule, claim form and submission channel
(portal, email, fax or mail) need the carrier's own documents before they can be built. The
"claim not prepared" link for those carriers searches Works by the carrier's name; no workflow
matches yet.

The milestone-schedule bug, where a Hyatt or LegalShield matter could be given a direct-pay fee
schedule, was already fixed by `20261214000000_engagement_seed_respects_payor.sql`, which skips
seeding for any carrier-billed matter.
