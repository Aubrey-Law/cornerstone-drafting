# Legal-plan carriers in the ledger

The firm takes four legal plans: **MetLife, LegalEASE, ARAG and CLC**. A matter's billing type
offers those four, flat fee, and "Other legal plan". Each of the four is a carrier everywhere a
carrier is listed: the plan claim, the carrier invoice, the per-plan card and the reminders.

## The four plans

- `MATTER_BILLING_TYPES` (`lib/billing/billingType.ts`) is the one list. `billingPlans`
  (`lib/billing/types.ts`) is the same list without flat fee and "Other legal plan".
  `billingPlanLabels` takes each name from the billing-type labels, so the two cannot drift.
  `billingPlanFor()` maps a matter's billing type, or its `legal_plan` display name, to a carrier.
- Invoice payers (`lib/billing/invoices.ts`) are the client plus every carrier. A carrier invoice
  is any invoice whose payer is not the client, so it is never emailed, shown in the portal,
  offered for checkout or reminded.
- **Start a claim** defaults to the matter's own carrier.
- The lead rail, the client's portal intake, the engagement letter, lead scoring, the design
  meeting checklist and the PMPS preflight skill all name the same four.

"Other legal plan" is still not a carrier. It names no one to bill, so a claim is recorded once
the firm knows which plan it is, by changing the matter's billing type.

### Hyatt and LegalShield

Both were removed on 2026-10-07: the firm does not take them. No matter, intake, billing item or
invoice named either, so nothing was remapped. Old free text that names them (an import, a
Lawmatics value) reads as "Other legal plan".

## Fee schedules

When a plan claim is added, **Add charge** offers the carrier's fee schedule, if the app has one.
Choosing a row fills the description and amount; rows priced on assets, hours or a document count
ask for that number first. "Custom or combined claim" is always there for anything else.

| Carrier | Schedule | Source |
|---|---|---|
| MetLife | `lib/metlife/pricing.ts` | Massachusetts schedule, location 20907. Also has a claim document and the Prepare MetLife claim workflow. |
| ARAG | `lib/arag/pricing.ts` | ARAG Fee Schedule effective February 1, 2026. Estate, probate, guardianship, elder law and document rows only. |
| LegalEASE | none yet | Entered by hand. |
| CLC | none yet | Entered by hand; needs CLC's fee schedule and claim form. |

`lib/billing/planFeeSchedules.ts` registers each schedule with the dialog. Adding a carrier's
schedule means a pricing module and one entry there.

### ARAG rules worth knowing

- ARAG pays the schedule amount as the **whole** fee for the covered matter. Paid-in-full matters
  are paid once the entire matter is complete.
- A standalone estate plan is complete when executable documents go to the member, or after 90
  days without contact, whichever comes first.
- The $25 initial consultation is added to the matter payment. It is listed so a declined matter
  can still be claimed.
- Wills for a member and spouse are one **combined** package, never two individual ones.
- Paid-in-full probate is 1.25% of the assets subject to probate at death, minimum $1,000,
  maximum $4,000. Hourly plans pay $100 an hour up to the hours on the case confirmation; once
  those run out, claim within 180 days.
- Standalone documents pay per document up to a cap (a deed is $55 each, at most $275).
- The case confirmation (CaseAssist) says whether the member's plan is paid-in-full or hourly.

## Migrations

- `20270122090000_legal_plan_carriers.sql` made every named plan a carrier.
- `20270129090000_legal_plans_metlife_legalease_arag_clc.sql` narrows the billing type, plan and
  payer checks to the four plans, and restates the four functions that carry their own copy of
  the list: `legal_plan_display_name`, `update_lead_opportunity_field`,
  `update_lead_opportunity_details` and `lead_score`. Each is its live definition with only the
  list changed; `tests/legal-plans-four-carriers.test.ts` checks that byte for byte.
