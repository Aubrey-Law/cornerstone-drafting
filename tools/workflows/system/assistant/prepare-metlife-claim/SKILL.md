---
name: Prepare MetLife Claim
description: Prepare the MetLife Legal Plan reimbursement claim checklist and portal submission table from approved Massachusetts estate-planning matter facts.
version: 1.0.0
type: assistant
execution_mode: run
practice: Estate Planning
jurisdictions:
  - Massachusetts
allowed_context:
  - matter
  - intake
  - design_sheet
  - documents
---

PREPARE METLIFE CLAIM: Generate the reimbursement claim checklist and the portal submission table for a matter billed to the MetLife Legal Plan.

- Use only approved matter, intake, and design-sheet facts supplied by Cornerstone.
- Treat a requested run input as an attorney confirmation only when the attorney supplied it explicitly for that run.
- Mark missing or contradictory required information as `[UNKNOWN]`; block generation instead of guessing.
- Never infer legal-plan coverage, member eligibility, member ID, or the service window.
- Bill only documents the design sheet actually includes. Never add a line item for work the matter does not contain.
- Every section total and the grand total are computed from the line items. Never state a total that was not summed.
- Keep the generated Word document isolated from the matter until the attorney reviews it and confirms the run.
- Do not submit anything to the MetLife attorney portal, share documents with a client, or change any other matter record.
- The generated claim is a draft pending attorney review and approval before submission or reliance.

## Plan composition

The matter's documents determine which of the five MetLife plan compositions applies:

- `separate_trust` — married, each spouse has their own individual revocable trust
- `joint_trust` — married, one shared joint revocable trust
- `will_couple` — married, will-based plan with no trust
- `will_individual` — single person, will-based plan
- `individual_trust` — single person, individual revocable trust

A Realty Trust and Deed section repeats once per property when the matter includes a real estate transfer.

## MetLife billing names

Always bill under MetLife terminology, never the Aubrey Law internal name:

| Aubrey Law name | MetLife billing name |
|---|---|
| Durable Power of Attorney | Power of Attorney (Financial) |
| Health Care Proxy | Power of Attorney (Medical) |
| HIPAA Authorization | Power of Attorney (HIPAA) |
| Living Will | Advanced Medical Directive |
| Revocable Trust | Trust No-Tax Planning |
| Certificate of Trust | Affidavit |
| Minor Guardianship | Temporary Guardian Affidavit |

## Fee schedule

| Document | Member rate | Couple rate |
|---|---|---|
| Will | $150 | $185 |
| Trust (No-Tax Planning) | $325 | $400 |
| Advanced Medical Directive | $45 | $65 |
| Power of Attorney (Financial) | $60 | $85 |
| Power of Attorney (Medical) | $60 | $85 |
| Power of Attorney (HIPAA) | $60 | $85 |
| Affidavit | $65 | $65 |
| Deed | $90 | $90 |

All three powers of attorney bill at the same rate per MetLife guidelines.

In a `separate_trust` plan each pour-over will bills at the member rate of $150, not the couple rate of $185, because the wills are non-reciprocal.
