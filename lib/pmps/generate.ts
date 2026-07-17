import { Document, Footer, Header, HeadingLevel, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import fs from 'node:fs'
import path from 'node:path'
import { ANNUAL_GIFT_EXCLUSION_2026, FEDERAL_BASIC_EXCLUSION_2026, MA_ESTATE_EXCLUSION, computePmpsTax, type PmpsTaxScenario } from '@/lib/pmps/tax'
import type { PmpsArtifact, PmpsArtifactKind, PmpsData } from '@/lib/pmps/types'

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const
const TEAL = '1A7A6D'
const NAVY = '1B3A5C'
const GRAY = '666666'

function money(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function body(text: string, options: { bold?: boolean; italics?: boolean; color?: string } = {}) {
  return new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text, font: 'Garamond', size: 22, ...options })] })
}

function heading(text: string, level: typeof HeadingLevel.HEADING_1 | typeof HeadingLevel.HEADING_2 = HeadingLevel.HEADING_1) {
  return new Paragraph({ heading: level, spacing: { before: 180, after: 100 }, children: [new TextRun({ text, font: 'Garamond', color: level === HeadingLevel.HEADING_1 ? NAVY : TEAL, bold: true })] })
}

function pageHeading(text: string) {
  return new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_1, spacing: { after: 100 }, children: [new TextRun({ text, font: 'Garamond', color: NAVY, bold: true })] })
}

function bullet(text: string) {
  return new Paragraph({ bullet: { level: 0 }, spacing: { after: 70 }, children: [new TextRun({ text, font: 'Garamond', size: 21 })] })
}

function table(rows: Array<[string, string]>) {
  const cellText = (text: string, options: { bold?: boolean; color?: string } = {}) => new Paragraph({
    spacing: { before: 0, after: 35 },
    children: [new TextRun({ text, font: 'Garamond', size: 20, ...options })],
  })
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(([label, value], index) => new TableRow({ children: [
      new TableCell({ margins: { top: 70, bottom: 55, left: 120, right: 120 }, shading: { fill: index === 0 ? NAVY : 'EEF5F4' }, children: [cellText(label, { bold: true, color: index === 0 ? 'FFFFFF' : NAVY })] }),
      new TableCell({ margins: { top: 70, bottom: 55, left: 120, right: 120 }, shading: { fill: index === 0 ? NAVY : 'FFFFFF' }, children: [cellText(value, { bold: index === 0, color: index === 0 ? 'FFFFFF' : undefined })] }),
    ] })),
  })
}

function taxRows(s: PmpsTaxScenario): Array<[string, string]> {
  return [
    ['Taxable estate', money(s.taxableEstate)],
    ['Less statutory adjustment', money(60_000)],
    ['Adjusted taxable estate', money(s.adjustedTaxableEstate)],
    ['Bracket floor', money(s.bracketFloor)],
    ['Base tax', money(s.baseTax)],
    ['Excess at marginal rate', `${money(s.excess)} × ${(s.bracketRate * 100).toFixed(1)}%`],
    ['Gross tax', money(s.grossTax)],
    ['Massachusetts credit', money(s.credit)],
    ['Estimated net tax', money(s.netTax)],
  ]
}

function selectedDocumentNames(data: PmpsData) {
  const d = data.documents
  return [
    d.include_trust && 'Revocable Living Trust',
    (d.include_pour_over_will || d.include_simple_will || d.include_testamentary_trust_will) && 'Will',
    d.include_dpoa && 'Durable Power of Attorney', d.include_hcp && 'Health Care Proxy',
    d.include_hipaa && 'HIPAA Authorization', d.include_ahd && 'Advance Health Directive',
    d.include_ppm && 'Personal Property Memorandum', d.include_parental_appointment && 'Parental Appointment',
  ].filter(Boolean) as string[]
}

function planLabel(data: PmpsData) {
  return ({
    joint_outright: 'Joint plan with outright disposition to surviving spouse',
    joint_disclaimer: 'Joint trust with disclaimer-based credit shelter planning',
    separate_clayton: 'Separate trusts with credit shelter and Clayton election planning',
    individual_single: 'Individual estate plan',
  } satisfies Record<PmpsData['planStructure'], string>)[data.planStructure]
}

function baseDocument(title: string, data: PmpsData, children: Array<Paragraph | Table>) {
  let logo: Buffer | null = null
  try { logo = fs.readFileSync(path.join(process.cwd(), 'public', 'aubrey-law-logo.jpg')) } catch { /* text header remains */ }
  const clientNames = [data.clients.client.fullName, data.clients.spouse?.fullName].filter(Boolean).join(' and ')
  const headerChildren: Paragraph[] = []
  if (logo) headerChildren.push(new Paragraph({ children: [new ImageRun({ data: logo, transformation: { width: 115, height: 38 }, type: 'jpg' })] }))
  headerChildren.push(new Paragraph({ children: [new TextRun({ text: 'AUBREY LAW', font: 'Garamond', bold: true, color: TEAL, size: 22 })] }))
  return new Document({
    styles: { default: { document: { run: { font: 'Garamond', size: 22 } } } },
    sections: [{
      headers: { default: new Header({ children: headerChildren }) },
      footers: { default: new Footer({ children: [new Paragraph({ children: [new TextRun({ text: 'DRAFT — ATTORNEY REVIEW REQUIRED | Aubrey Law | Needham, Massachusetts', font: 'Garamond', size: 16, color: GRAY, italics: true })] })] }) },
      children: [
        new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: title, font: 'Garamond', size: 34, bold: true, color: NAVY })] }),
        body(`${clientNames} | ${data.date}`, { color: GRAY }),
        ...children,
        heading('Review status', HeadingLevel.HEADING_2),
        body('All documents are drafts pending attorney review and approval before client delivery or reliance. Tax computations are planning estimates pending verification against the current Massachusetts M-706 process.', { italics: true }),
      ],
    }],
  })
}

function agenda(data: PmpsData) {
  const tax = computePmpsTax(data.grossEstate, data.planStructure)
  return baseDocument('Peace of Mind Planning Session — Attorney Agenda', data, [
    heading('Meeting objectives'),
    bullet('Confirm family, fiduciary, and beneficiary facts before relying on the proposed plan.'),
    bullet(`Review the approved structure: ${planLabel(data)}.`),
    bullet(`Walk through the current gross estate of ${money(data.grossEstate)} and estimated Massachusetts exposure.`),
    heading('Family and fiduciaries'),
    ...data.children.map(child => bullet(`${child.full_name}${child.dob ? ` — DOB ${child.dob}` : ''}${child.minor ? ' (minor)' : ''}`)),
    table([['Role', 'Primary appointment'], ['Personal representative', data.fiduciaries.pr_primary ?? '[UNKNOWN]'], ['Trustee', data.fiduciaries.trustee_initial ?? data.clients.client.fullName], ['DPOA agent', data.fiduciaries.dpoa_primary ?? '[UNKNOWN]'], ['Health-care agent', data.fiduciaries.hcp_primary ?? '[UNKNOWN]']]),
    heading('Tax discussion'),
    body(`Estimated tax without credit-shelter planning: ${money(tax.withoutPlanning.netTax)}.`),
    ...(tax.withPlanning ? [body(`Estimated tax with the selected structure: ${money(tax.withPlanning.netTax)}; estimated savings ${money(tax.savings)}.`)] : []),
    bullet(`2026 annual gift-tax exclusion: ${money(ANNUAL_GIFT_EXCLUSION_2026)} per donee; confirm applicability before recommending a transfer.`),
    heading('Pricing'),
    body(data.hasLegalPlan ? `Legal plan: ${data.legalPlanName ?? 'confirmed; carrier name not supplied'}. Confirm covered services before billing.` : `Approved flat fee: ${money(data.flatFee ?? 0)}.`),
  ])
}

function proposal(data: PmpsData) {
  const tax = computePmpsTax(data.grossEstate, data.planStructure)
  return baseDocument('Estate Plan Proposal', data, [
    heading('Your planning profile'),
    body(`Your approved matter information reflects a gross estate of approximately ${money(data.grossEstate)}. The proposed planning structure is ${planLabel(data).toLowerCase()}.`),
    heading('Recommended documents'),
    ...selectedDocumentNames(data).map(name => bullet(`${name}${data.clients.type === 'couple' ? ' for each spouse where applicable' : ''}`)),
    heading('Massachusetts estate-tax analysis'),
    body(`Massachusetts currently provides a ${money(MA_ESTATE_EXCLUSION)} estate-tax exclusion. The estimated tax using the current estate value is ${money(tax.withoutPlanning.netTax)} before credit-shelter planning.`),
    ...(tax.withPlanning ? [body(`The selected planning structure is estimated to reduce that amount to ${money(tax.withPlanning.netTax)}, for estimated savings of ${money(tax.savings)}. Election and funding requirements must be reviewed at the first death.`)] : []),
    body(`The 2026 federal basic exclusion amount is ${money(FEDERAL_BASIC_EXCLUSION_2026)} per individual. Federal and Massachusetts rules must be evaluated separately.`),
    heading('Fiduciary appointments'),
    table([['Role', 'Appointment'], ['Personal representative', data.fiduciaries.pr_primary ?? '[UNKNOWN]'], ['Successor trustee', data.fiduciaries.trustee_successor ?? '[UNKNOWN]'], ['DPOA agent', data.fiduciaries.dpoa_primary ?? '[UNKNOWN]'], ['Health-care agent', data.fiduciaries.hcp_primary ?? '[UNKNOWN]']]),
    heading('Fee and next steps'),
    body(data.hasLegalPlan ? `Services will be submitted under ${data.legalPlanName ?? 'the confirmed legal plan'}, subject to carrier coverage and approval.` : `The approved flat fee is ${money(data.flatFee ?? 0)}.`),
    bullet('Attorney confirms this proposal and resolves any remaining planning questions.'),
    bullet('Drafting begins from the attorney-approved Cornerstone design sheet.'),
    bullet('Clients review drafts and requested revisions before execution planning.'),
  ])
}

function taxWorksheet(data: PmpsData) {
  const tax = computePmpsTax(data.grossEstate, data.planStructure)
  return baseDocument('Massachusetts Estate Tax Worksheet — Attorney Use', data, [
    heading('Scenario 1 — Current estate'), table(taxRows(tax.withoutPlanning)),
    ...(tax.withPlanning ? [heading('Scenario 2 — Selected credit-shelter structure'), table(taxRows(tax.withPlanning)), heading('Estimated comparison', HeadingLevel.HEADING_2), table([['Result', 'Estimate'], ['Scenario 1 tax', money(tax.withoutPlanning.netTax)], ['Scenario 2 tax', money(tax.withPlanning.netTax)], ['Estimated savings', money(tax.savings)]])] : []),
    pageHeading('Authority, method, and attorney review'),
    body('AUTHORITY: Massachusetts General Laws chapter 65C and the Massachusetts Department of Revenue Form M-706 instructions for dates of death on or after August 1, 2025; checked July 17, 2026.'),
    body('The calculation uses the pre-2001 IRC §2011 state-death-tax-credit table, a $60,000 adjusted-taxable-estate reduction, and the Massachusetts credit of up to $99,600. Out-of-state real and tangible property requires matter-specific review under current law.'),
    heading('Attorney verification checklist', HeadingLevel.HEADING_2),
    bullet('Reconcile the approved asset inventory, ownership, valuation dates, debts, deductions, and adjusted taxable gifts against the applicable M-706 inputs.'),
    bullet('Review domicile and the situs of every real-property, tangible-property, and closely held business interest before relying on the estimate.'),
    bullet('Confirm the selected trust structure, funding assumptions, and any federal or Massachusetts QTIP election with the governing instruments and then-current law.'),
    bullet('For disclaimer planning, confirm the surviving spouse has not accepted benefits or control and obtain matter-specific advice before any disclaimer deadline.'),
    bullet('Document the attorney-approved conclusion separately; this worksheet is a planning illustration, not a filed return or tax opinion.'),
    heading('Calculation record', HeadingLevel.HEADING_2),
    body(`FACT PROVENANCE: CALCULATED. Gross-estate input ${money(data.grossEstate)}; selected structure ${data.planStructure}; Massachusetts exclusion ${money(MA_ESTATE_EXCLUSION)}; method and result shown in the tables on page 1.`),
  ])
}

function onePage(data: PmpsData) {
  const tax = computePmpsTax(data.grossEstate, data.planStructure)
  return baseDocument('Your Estate Plan — One-Page Summary', data, [
    table([['Planning item', 'Summary'], ['Plan structure', planLabel(data)], ['Gross estate', money(data.grossEstate)], ['Estimated MA tax', money(tax.withoutPlanning.netTax)], ['Estimated planning savings', money(tax.savings)]]),
    heading('Documents'), ...selectedDocumentNames(data).map(bullet),
    heading('Key appointments'),
    bullet(`Personal representative: ${data.fiduciaries.pr_primary ?? '[UNKNOWN]'}`),
    bullet(`Successor trustee: ${data.fiduciaries.trustee_successor ?? '[UNKNOWN]'}`),
    bullet(`DPOA agent: ${data.fiduciaries.dpoa_primary ?? '[UNKNOWN]'}`),
    bullet(`Health-care agent: ${data.fiduciaries.hcp_primary ?? '[UNKNOWN]'}`),
    heading('Pricing'),
    body(data.hasLegalPlan ? `${data.legalPlanName ?? 'Legal-plan'} coverage is subject to carrier confirmation.` : `Approved flat fee: ${money(data.flatFee ?? 0)}.`),
  ])
}

const BUILDERS: Record<PmpsArtifactKind, { suffix: string; build: (data: PmpsData) => Document }> = {
  agenda: { suffix: 'Agenda', build: agenda }, proposal: { suffix: 'Proposal', build: proposal },
  tax_worksheet: { suffix: 'TaxWorksheet', build: taxWorksheet }, one_page_summary: { suffix: 'OnePageSummary', build: onePage },
}

export async function generatePmpsArtifacts(data: PmpsData, selectedKinds: PmpsArtifactKind[]): Promise<PmpsArtifact[]> {
  return Promise.all(selectedKinds.map(async kind => {
    const definition = BUILDERS[kind]
    return { kind, filename: `${data.filePrefix}_PMPS_${definition.suffix}.docx`, contentType: DOCX, bytes: await Packer.toBuffer(definition.build(data)) }
  }))
}
