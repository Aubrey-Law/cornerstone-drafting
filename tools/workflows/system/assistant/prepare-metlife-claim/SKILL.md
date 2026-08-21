---
name: Prepare MetLife Claim
description: Prepare the MetLife Legal Plan reimbursement claim checklist and portal submission table from approved Massachusetts estate-planning matter facts.
version: 1.1.0
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
- Auto-populate the approved core charge rows from the selected or derived plan composition. Optional deed, realty-trust, and affidavit work must still come from approved matter or run facts.
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

## Auto-populated estate-planning charges

Keep the rows in this order. Couple wills are two individual CT 200 charges,
not one reciprocal-will charge. HIPAA and trust affidavits are not core-package
charges.

| Plan composition | Auto-populated rows |
|---|---|
| `joint_trust` | CT 200 individual will — Member; CT 200 individual will — Spouse; CT 220 Financial POA — Member and Spouse; CT 220 Health Care POA — Member and Spouse; CT 230 Living Will — Member and Spouse; CT 260 Trust — Member and Spouse |
| `separate_trust` | CT 200 individual will — Member; CT 200 individual will — Spouse; CT 220 Financial POA — Member and Spouse; CT 220 Health Care POA — Member and Spouse; CT 230 Living Will — Member and Spouse; CT 260 individual trust — Member; CT 260 individual trust — Spouse |
| `will_couple` | CT 200 individual will — Member; CT 200 individual will — Spouse; CT 220 Financial POA — Member and Spouse; CT 220 Health Care POA — Member and Spouse; CT 230 Living Will — Member and Spouse |
| `individual_trust` | CT 200 individual will — Member; CT 220 Financial POA — Member; CT 220 Health Care POA — Member; CT 230 Living Will — Member; CT 260 individual trust — Member |
| `will_individual` | CT 200 individual will — Member; CT 220 Financial POA — Member; CT 220 Health Care POA — Member; CT 230 Living Will — Member |

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
| Advanced Medical Directive | $45 | $60 |
| Power of Attorney (Financial) | $60 | $85 |
| Power of Attorney (Medical) | $60 | $85 |
| Power of Attorney (HIPAA) | $60 | $85 |
| Affidavit | $65 | $65 |
| Deed | $90 | $90 |

All three powers of attorney bill at the same rate per MetLife guidelines.

These rates use the Massachusetts fee schedule, location code 20907. Claim
comments include the applicable CT code: Wills and Estates CT 200, 220, 230,
and 260; Deed CT 420; and the individually prepared stand-alone Affidavit rate
under CT 700. Probate (CT 250) and Inheritance Rights (CT 270) are available in
the Billing fee selector because their amounts depend on the service or matter
value rather than the estate-planning document package.

In a `separate_trust` plan each pour-over will bills at the member rate of $150, not the couple rate of $185, because the wills are non-reciprocal.
