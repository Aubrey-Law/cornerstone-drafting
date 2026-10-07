# Trust Administration practice area

This is Probate Phase 3, slice 5, part 1. It makes trust administration a practice area of its own,
**TA**.

Settling a trust after the grantor dies, or becomes incapacitated, is fiduciary work, as probate is.
There is no design meeting, drafting package or signing. Until now such a matter could only be filed
two ways:

- **as Estate Planning**, which gave it the 48-task estate checklist and an estate fee package;
- **as Probate**, which put a trust that never sees a court on the probate deadlines and court
  stages.

## What a TA matter gets today

| | Trust Administration |
|---|---|
| Matter number | `YYYY-TA-<client>-NNN` |
| Practice area pickers (matter, lead, assistant) | "Trust Administration" |
| Checklist | **none yet**. It never falls back to the estate checklist, on a lead or a hired matter. |
| Drafting workspace and Statular package | not offered, as for Probate |
| Engagement fee on signing | a plain flat-fee billing item; never an estate fixed-milestone package |
| Ledger | the **Trust ledger** card on the Overview: the same inventory, entries and account as the probate estate ledger. "Held in the trust" replaces "Probate property", so assets passing outside the trust are listed but kept out of the account. |
| Probate essentials, stages, deadlines, probate document list | probate only; not shown |
| Portal progress | the neutral "Your matter" view |
| Annual review on close | not queued (estate planning only) |

## What comes next (part 2)

Part 2 builds the trust-specific workflow, once the legal content has been reviewed:

- **Checklist:** a trust administration checklist.
- **Stages:** read from dates, as probate's are.
- **Deadlines:** for example, the notice to beneficiaries and the trust accounting.
- **Document list:** a trust document request list.

These hold legal periods and wording that should be the attorney's, as the probate deadline rules
are, so they are not guessed at here.

## Lawmatics

Practice areas reach Lawmatics through the option map in Settings. A TA matter only carries its
practice area to Lawmatics once "Trust Administration" is mapped there.

## Migration

`20270127090000_trust_administration_practice_area.sql`. A database decides practice area in five
places, and an unrecognised value either raises an error or silently becomes `EP`. Each is taught
TA:

- the `matter_details_practice_area_check` constraint;
- `normalize_shared_practice_area()`;
- `update_lead_opportunity_field()`;
- `convert_lead_to_matter()`;
- `seed_engagement_billing_item()`.

The four functions are restated whole from their live definitions with only the TA branch added.
`tests/trust-administration-practice-area.test.ts` checks this byte for byte, and
`tests/practice-area-sql-parity.test.ts` checks that every code the app offers is accepted
everywhere. No existing row changes: nothing is TA until someone chooses it.
