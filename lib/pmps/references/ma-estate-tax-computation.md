# Massachusetts Estate Tax Computation Reference

> **ALL DOLLAR FIGURES PRODUCED USING THIS REFERENCE ARE ESTIMATES PENDING
> ATTORNEY VERIFICATION AGAINST THE M-706 PROCESS.** This document describes
> methodology and structure, not final authoritative numbers. Every computed
> figure carried into a client document must be reviewed by Scott and flagged
> with `[VERIFY: ...]` where the underlying inputs are uncertain.

## Overview

Massachusetts imposes an estate tax computed using the former federal credit for
state death taxes under IRC §2011, **as that table existed on December 31, 2000**
(the "federalized base" — the Commonwealth froze its computation to pre-EGTRRA
law). Key rules:

1. **Exemption / filing threshold**: $2,000,000 per decedent. If the Massachusetts
   gross estate is $2,000,000 or less, no Massachusetts estate tax is due and no
   M-706 is required.
2. **Anti-cliff credit (2023 reform)**: Massachusetts no longer taxes the *entire*
   estate once the $2M threshold is crossed. Estates over $2,000,000 receive a
   credit (up to **$99,600**) that effectively exempts the first $2,000,000 of the
   taxable estate. The $99,600 figure is the §2011 tax on a $2,000,000 adjusted
   base and is applied as a **unified credit** against the computed gross tax.
3. **Adjusted taxable estate** = taxable estate − **$60,000** (the statutory
   §2011 adjustment).
4. **No portability**: Massachusetts does NOT allow a surviving spouse to use a
   deceased spouse's unused exemption. Each spouse's $2,000,000 exemption is
   "use it or lose it." The only way to preserve the first-to-die's exemption is
   to fund a credit shelter (bypass) amount at the first death.
5. **Rates** range to a top marginal rate of **16%**.
6. **M-706 due date**: nine (9) months after the date of death.

## Rate Table (pre-2001 IRC §2011 credit brackets, applied to the ADJUSTED taxable estate)

| Floor | Ceiling | Base Tax | Marginal Rate |
|-------|---------|----------|------|
| $0 | $40,000 | $0 | 0.0% |
| $40,000 | $90,000 | $0 | 0.8% |
| $90,000 | $140,000 | $400 | 1.6% |
| $140,000 | $240,000 | $1,200 | 2.4% |
| $240,000 | $440,000 | $3,600 | 3.2% |
| $440,000 | $640,000 | $10,000 | 4.0% |
| $640,000 | $840,000 | $18,000 | 4.8% |
| $840,000 | $1,040,000 | $27,600 | 5.6% |
| $1,040,000 | $1,540,000 | $38,800 | 6.4% |
| $1,540,000 | $2,040,000 | $70,800 | 7.2% |
| $2,040,000 | $2,540,000 | $106,800 | 8.0% |
| $2,540,000 | $3,040,000 | $146,800 | 8.8% |
| $3,040,000 | $3,540,000 | $190,800 | 9.6% |
| $3,540,000 | $4,040,000 | $238,800 | 10.4% |
| $4,040,000 | $5,040,000 | $290,800 | 11.2% |
| $5,040,000 | $6,040,000 | $402,800 | 12.0% |
| $6,040,000 | $7,040,000 | $522,800 | 12.8% |
| $7,040,000 | $8,040,000 | $650,800 | 13.6% |
| $8,040,000 | $9,040,000 | $786,800 | 14.4% |
| $9,040,000 | $10,040,000 | $930,800 | 15.2% |
| $10,040,000 | ∞ | $1,082,800 | 16.0% |

Unified credit (offsets tax on exactly $2,000,000): **$99,600**.

## Computation Algorithm

```
function computeMATax(taxableEstate):
    if taxableEstate <= 2,000,000:
        return { netTax: 0 }

    adjustedTaxableEstate = taxableEstate - 60,000

    Find bracket where: floor <= adjustedTaxableEstate < ceiling
    excess       = adjustedTaxableEstate - bracket.floor
    taxOnExcess  = excess * bracket.rate
    grossTax     = bracket.baseTax + taxOnExcess
    netTax       = grossTax - 99,600        # unified credit

    return { adjustedTaxableEstate, bracket, excess, taxOnExcess,
             grossTax, unifiedCredit: 99600, netTax }
```

**netTax is the figure carried into client documents.** The schema's
`tax.scenario*.netTax` / `netTaxDisplay` fields are net of the $99,600 credit.
If a worksheet ever needs the pre-credit number, label it explicitly as
"gross tax (before unified credit)" so it is never confused with netTax.

---

## Per-structure scenarios

The data field `plan.planStructure` selects which scenarios are computed and
which comparison columns the templates render.

### `joint_outright` — Joint Trust, Outright to Spouse (baseline / minimal planning)

All assets pass to the surviving spouse at the first death (unlimited marital
deduction → $0 at first death). **No credit shelter is funded**, so the first
spouse's $2,000,000 exemption is wasted. At the second death the full combined
estate is taxed using one exemption.

- `scenario1` (the only scenario): `taxableEstate = grossEstate`; compute netTax.
- `scenario2 = null`. No comparison column. `savings = 0`.
- Positioning: quantify the lost-exemption exposure — this is the cost of doing nothing.

### `joint_disclaimer` — Joint Trust, Disclaimer Planning

A single joint trust. At the first death the surviving spouse **may disclaim**
up to $2,000,000 into a credit shelter (bypass) trust within nine months,
preserving the first spouse's exemption. Combined with the survivor's own
$2,000,000 exemption, **$4,000,000 total** is sheltered — *but only if the
disclaimer is valid and timely.* If the survivor fails to disclaim correctly,
the result reverts to the `joint_outright` (one-exemption) outcome.

- `scenario1` "Without Planning": `taxableEstate = grossEstate` (full estate, one exemption at second death).
- `scenario2` "With Disclaimer Planning":
  - `firstDeath`: `bypassAmount = 2,000,000`, `grossTax = 99,600`, `credit = 99,600`, `netTax = 0`.
  - `secondDeath`: **`taxableEstate = grossEstate − 4,000,000`** (both exemptions preserved), compute netTax.
  - `totalNetTax = firstDeath.netTax + secondDeath.netTax`.
- `savings = scenario1.netTax − scenario2.totalNetTax`.
- Positioning: flag the dependency/risk — the planning fails if the survivor does not disclaim properly and on time.

### `separate_clayton` — Separate Revocable Trusts + Credit Shelter + Clayton Election

Two separate revocable trusts (one per spouse). At the first death the trust
divides into a Credit Shelter (Bypass) Trust and a Marital (QTIP) Trust. The
credit-shelter/marital division is **fiduciary-controlled via the Clayton
election** — it does not depend on the surviving spouse acting. Both
$2,000,000 exemptions are preserved (**$4,000,000 total**). Most reliable option;
best fit for larger or illiquid-business estates.

- Scenario math is identical to `joint_disclaimer`:
  - `scenario1` "Without Planning": `taxableEstate = grossEstate`.
  - `scenario2` "With Credit Shelter + Clayton":
    - `firstDeath`: `bypassAmount = 2,000,000`, `netTax = 0`.
    - `secondDeath`: **`taxableEstate = grossEstate − 4,000,000`**, compute netTax.
    - `totalNetTax`.
  - `savings = scenario1.netTax − scenario2.totalNetTax`.
- Difference is structural/positioning, not arithmetic: the election is
  fiduciary-controlled (reliable), and the MA-only QTIP election is coordinated
  deliberately against the federal election (see *Shaffer*, below).

### `individual_single` — Individual Trust, single person

No spouse, so no marital deduction, no credit shelter, no Clayton/QTIP
machinery. One $2,000,000 exemption; a single death scenario.

- `scenario1` "At Death": `taxableEstate = grossEstate`; compute netTax.
- `scenario2 = null`, `savings = 0`. Single comparison column only.
- Positioning: threshold monitoring and lifetime strategies (gifting,
  charitable, ILIT). No spouse / second-death references anywhere.

---

## CRITICAL FIX (enforced in this revision)

The prior reference computed the "with planning" second-death taxable estate as
`grossEstate − $2,000,000` (a single exemption) while the narrative claimed
"$4 million total" was sheltered. **Corrected:** for both `joint_disclaimer` and
`separate_clayton`, the both-exemptions-preserved scenario reduces the
second-death taxable estate by **$4,000,000**. The rendered tax table and the
narrative must agree. Any SAMPLE data object must encode the $4,000,000 shelter.

---

## Massachusetts-specific planning notes (incorporate into proposal/worksheet)

- **State-only QTIP election.** Massachusetts allows a QTIP election for state
  estate tax purposes that is **independent of the federal QTIP election**
  (TIR 86-4; M.G.L. c. 65C). This is what makes preserving both $2M exemptions
  workable at the state level even when no federal election is made.
- ***Shaffer v. Commissioner of Revenue*, SJC-12812 (2020).** Coordinate the
  federal and Massachusetts-only QTIP elections deliberately. *Shaffer*
  cautions that election mismatches can produce unexpected Massachusetts results;
  document the intended coordination. (Full treatment in `separate_clayton`;
  brief note in `joint_disclaimer`; omit for the other two.)
- **2025 Mass. Acts Ch. 9, §35 — out-of-state property computation.** Where the
  estate holds real or tangible property situated outside Massachusetts, the
  Massachusetts tax is computed with a proportional adjustment for the
  out-of-state property. **Flag illiquid business interests for situs review** —
  their location and apportionment can materially change the Massachusetts
  result. (Emphasize for `separate_clayton`; note where applicable otherwise.)

---

## Worked example — $14,391,911 gross estate (couple)

> **Estimates pending M-706 verification.** Net of the $99,600 unified credit.

**Scenario 1 — Without Planning (full estate, one exemption at second death):**
- taxableEstate = $14,391,911
- adjustedTaxableEstate = $14,331,911 → top bracket (floor $10,040,000, base
  $1,082,800, 16%)
- excess = $4,291,911 → taxOnExcess = $686,705.76 → round to $686,706
- grossTax = $1,082,800 + $686,706 = $1,769,506
- **netTax = $1,769,506 − $99,600 = $1,669,906**

**Scenario 2 — Both exemptions preserved (second-death taxable = gross − $4,000,000):**
- firstDeath: bypassAmount $2,000,000 → netTax $0
- secondDeath taxableEstate = $14,391,911 − $4,000,000 = $10,391,911
- adjustedTaxableEstate = $10,331,911 → top bracket
- excess = $291,911 → taxOnExcess = $46,705.76 → round $46,706
- grossTax = $1,082,800 + $46,706 = $1,129,506
- **netTax = $1,129,506 − $99,600 = $1,029,906**

**Savings = $1,669,906 − $1,029,906 = $640,000.**

### ⚠️ Methodology check for Scott before "go"

The update runbook cites this example as **≈ $1,769,506 / $1,129,506 / $640,000**.
Those first two figures equal the **gross tax (before the $99,600 unified credit)**.
This reference instead reports **net tax** ($1,669,906 / $1,029,906), because the
schema's `netTax` fields and the client-facing templates render net-of-credit
figures. The **savings ($640,000) is identical either way** — the credit cancels
in the subtraction.

**Decision needed:** confirm that client documents should show **net tax**
(my recommendation, consistent with the schema and the anti-cliff credit), or
tell me you want the **gross** figures shown. Do not let any template branch on
these numbers until you've reconciled this against your M-706.
