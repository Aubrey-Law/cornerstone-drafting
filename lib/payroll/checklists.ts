/** The workbook's Checklists tab, item for item. */

export type ChecklistScope = 'setup' | 'payroll' | 'quarter' | 'year'

export interface ChecklistItem {
  key: string
  task: string
  note?: string
}

export const CHECKLISTS: Record<ChecklistScope, { title: string; items: ChecklistItem[] }> = {
  setup: {
    title: 'One-time setup (before the first paycheck)',
    items: [
      { key: 'w2-only', task: 'Confirm you are on the payroll as an employee and that W-2 wages are the only way you are paid for services', note: 'Compensation must be W-2 wages; distributions come after.' },
      { key: 'reasonable-comp-memo', task: 'Document your reasonable-compensation figure', note: 'Short memo to file; run it past your CPA.' },
      { key: 'eftps', task: 'Enroll in EFTPS and set up the business bank account for federal deposits', note: 'eftps.gov; allow time for the PIN mailer.' },
      { key: 'masstaxconnect', task: 'Register for MA withholding in MassTaxConnect', note: 'Confirm your filing frequency.' },
      { key: 'dua', task: 'Register for MA unemployment insurance with DUA', note: 'You will receive your rate notice. Update Setup.' },
      { key: 'dfml', task: 'Register with DFML for PFML contributions', note: 'Post the PFML notice and give yourself the new-hire notice.' },
      { key: 'w4-m4-i9', task: 'Complete Form W-4 and Form M-4 for yourself and keep Form I-9 on file', note: 'Use the IRS Tax Withholding Estimator for the per-check federal figure.' },
      { key: 'workers-comp', task: "Confirm workers' compensation requirements", note: 'MA has rules for corporate officers; verify with your insurer or the DIA.' },
      { key: 'setup-tab', task: 'Fill in the Setup tab and confirm the flagged rates' },
    ],
  },
  payroll: {
    title: 'Each payroll',
    items: [
      { key: 'enter', task: 'Enter pay date and gross wages on the Register', note: 'Pay yourself on a consistent schedule.' },
      { key: 'review', task: 'Review the paycheck math (withholdings, net pay) for reasonableness', note: 'Compare to the prior check.' },
      { key: 'pay-net', task: 'Pay net wages by ACH or check from the business account' },
      { key: 'post-journal', task: 'Post the journal entry to your books', note: 'Check it says Balanced.' },
      { key: 'fed-deposit', task: 'Make the federal deposit by the Register due date in EFTPS', note: 'Record the date and confirmation number on the Register.' },
      { key: 'ma-deposit', task: 'Make the MA withholding deposit per your assigned frequency' },
    ],
  },
  quarter: {
    title: 'Each quarter',
    items: [
      { key: 'reconcile', task: 'Reconcile Quarterly totals to your books and deposits', note: 'Federal and MA liabilities should match what you paid.' },
      { key: '941', task: 'File Form 941', note: 'Due dates are on the Deadlines tab.' },
      { key: 'dua', task: 'File the MA DUA wage report and pay UI contributions' },
      { key: 'pfml', task: 'File the MA PFML report and remit contributions' },
      { key: 'futa', task: 'Deposit FUTA if the cumulative liability exceeds $500' },
    ],
  },
  year: {
    title: 'Year-end',
    items: [
      { key: 'rates', task: 'Re-check all rates and wage bases for the new year', note: 'Social Security base, MA rates, DUA notice, PFML rate.' },
      { key: 'reasonable-comp', task: 'Reasonable-compensation review with CPA before December payroll' },
      { key: 'annual-filings', task: 'File Form 940, W-2/W-3, and the MA annual reconciliation and W-2 filing', note: 'Due January 31.' },
      { key: 'cpa-packet', task: 'Send your CPA the Register, Quarterly summary and filed returns' },
    ],
  },
}

export const CHECKLIST_SCOPES = Object.keys(CHECKLISTS) as ChecklistScope[]

/** Setup and year-end lists are once per year; the others repeat per run or per quarter. */
export function checklistNeedsPeriod(scope: ChecklistScope): boolean {
  return scope === 'payroll' || scope === 'quarter'
}
