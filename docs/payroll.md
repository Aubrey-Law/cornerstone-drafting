# Payroll

`/admin/payroll` runs payroll for the firm's one owner-employee: a single-member LLC
taxed as an S corp, paying W-2 wages in Massachusetts. It replaces the
`Payroll_System.xlsx` workbook tab for tab, and its arithmetic reproduces that
workbook to the cent (`tests/payroll-calc.test.ts` pins a full year recalculated
from the workbook by LibreOffice).

Only the `admin` role can open it. Every route uses `requireAdministrator`, and RLS
limits reads to admins.

## What it does

| Tab | Workbook tab | What happens |
|---|---|---|
| Register | Register | Add a pay date and gross wages; see the check before saving. Record when net pay, the EFTPS deposit (with its confirmation number) and the MA withholding deposit were paid. Finalize a run once it's paid. Download the pay stub PDF or the run's journal CSV. |
| Quarterly & W-2 | Quarterly | Per-quarter Form 941 figures (lines 2, 3, 5a/5c/5d, the line 7 fractions-of-cents difference, and the line 12 basis), the $2,500 deposit rule, the FUTA $500 flag, MA withholding, DUA and PFML totals. The W-2 box tie-out. |
| Deadlines | Deadlines | 941 ×4, DUA ×4, PFML ×4, Form 940, W-2/W-3, the MA annual reconciliation, the reasonable-compensation review, and a federal deposit for each pay date. Mark them done and record confirmation numbers. **Sync to calendar** puts a non-blocking 9:00 reminder for each open deadline on the firm's Google Calendar. |
| Journal | Journal | The balanced entry for any pay date. CSV export by run, quarter or year for Mercury Accounting, including deposit and remittance entries once they're recorded as paid. |
| Checklists | Checklists | The setup, per-payroll, per-quarter and year-end lists, ticked per run or quarter. |
| Setup | Setup | Rates, wage bases, per-check federal withholding, and employer/employee details for the stub. |

## How the numbers work

- **Pure logic** lives in `lib/payroll/`: `calc.ts`, `quarterly.ts`, `deadlines.ts`, `journal.ts` and `checklists.ts`. Database access is in `server.ts`.
- **Units:** money is integer cents and rates are integer millionths. Each figure is rounded once, half-up, at the point where the workbook's `ROUND(…, 2)` rounds it.
- **YTD wages** come from the Setup tab's "wages already paid" plus the earlier runs in the year. Social Security, FUTA, MA UI and PFML stop at their wage bases. Additional Medicare applies only to the part of a check above $200,000.
- **Federal income tax withholding is not calculated.** Enter the per-check figure from the IRS Tax Withholding Estimator or Pub 15-T on Setup, and override it on a single run if needed. This avoids maintaining bracket tables.
- **Draft vs finalized runs:**
  - A draft run is recomputed whenever settings or an earlier run change.
  - A finalized run keeps the figures it was paid with. If today's settings would compute it differently, the register says so.
  - A run's inputs can only be edited while it is a draft.
- **Due dates** that fall on a weekend roll to Monday. Holidays are not modelled.

## Every January

1. Move to the new year on the page. Its settings start from the previous year's rates.
2. Update the Social Security wage base, the DUA rate notice (UI, Workforce Training Fund, EMAC, COVID), the PFML rate, the MA exemption and the per-check federal withholding.
3. Tick "I have confirmed the flagged rates" and save.

## Not covered

- S corp items that change W-2 wages, such as health insurance for a more-than-2% shareholder, are not modelled. Tell your CPA about them.
- Semi-weekly depositor rules. The module assumes a monthly depositor.
- MA withholding deposit dates. These follow the frequency MassTaxConnect assigns.
- Filing anything with an agency. The module computes and tracks; you still file.

## Next step: Mercury matching

The firm's Mercury accounts include Payroll ••0301 and Govt Payments ••9774. A
follow-up can suggest matches between Mercury transactions and each net-pay and
tax deposit, in the propose-and-confirm style of the deposit worklist described in
`docs/integrations/mercury-bank-reconciliation.md`. Today, deposits are recorded by hand.
