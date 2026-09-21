import { createHash } from 'node:crypto'
import PizZip from 'pizzip'
import { describe, expect, it } from 'vitest'
import { renderEngagementAgreement } from '@/lib/engagement/render'
import { allEngagementAnchorMarkers } from '@/lib/engagement/anchors'

const anchors = allEngagementAnchorMarkers(2)
const soloAnchors = allEngagementAnchorMarkers(1)

function pdf(text: string, width = 612, height = 792): Buffer {
  const escaped = text.replace(/([\\()])/g, '\\$1')
  const stream = `BT /F1 10 Tf 50 700 Td (${escaped}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(out)); out += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(out)
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(out)
}

const input = {
  practiceArea: 'EP' as const, clientMode: 'couple' as const, agreementDate: '2026-07-12',
  primary: { name: 'Alex Client', email: 'alex@example.com' },
  spouse: { name: 'Jordan Client', email: 'jordan@example.com' }, legalPlan: null,
  fee: { amount: 7500, paymentTerms: 'Half now; half before signing.' }, scopeKey: 'standard',
  optionalClauseKeys: [] as string[], emailMessage: '', expirationHours: 72,
}

/**
 * A plan-funded couple. Its fee is whatever the plan's schedule pays, so the
 * letter states none — which is why the firm's flat fee and payment terms are
 * empty here and the render still succeeds.
 */
const lpInput = {
  ...input,
  practiceArea: 'EP-LP' as const,
  legalPlan: 'metlife' as const,
  fee: { amount: 0, paymentTerms: '' },
}

/** The same letter for a solo client: one signer, no spouse. */
const lpSoloInput = { ...lpInput, clientMode: 'individual' as const, spouse: null }

describe('renderEngagementAgreement', () => {
  it('renders all structured fields and stable metadata without legacy tags', async () => {
    const converted = pdf(anchors.join(' '))
    const result = await renderEngagementAgreement(input, { convertDocx: async () => converted })
    const xml = new PizZip(result.docxBytes).file('word/document.xml')!.asText()
    for (const value of ['2026-07-12', 'Alex Client', 'alex@example.com', 'Jordan Client', 'jordan@example.com', '$7,500.00', 'Half now; half before signing.']) expect(xml).toContain(value)
    for (const anchor of anchors) expect(xml.split(anchor)).toHaveLength(2)
    expect(xml).not.toMatch(/\{\{(?:signature:|autofill_date_signed)|\{[^{}]+\}/)
    expect(result.masterKey).toBe('ep-trust-couple')
    expect(result.masterVersion).toBe('1')
    expect(result.pdfSha256).toBe(createHash('sha256').update(converted).digest('hex'))
  })

  it('renders the legal-plan letter, naming the plan and marking elected services', async () => {
    const converted = pdf(anchors.join(' '))
    const result = await renderEngagementAgreement(
      { ...lpInput, optionalClauseKeys: ['credit_shelter_planning'] },
      { convertDocx: async () => converted },
    )
    const xml = new PizZip(result.docxBytes).file('word/document.xml')!.asText()
    expect(xml).toContain('MetLife')
    for (const value of ['2026-07-12', 'Alex Client', 'alex@example.com', 'Jordan Client', 'jordan@example.com']) expect(xml).toContain(value)
    for (const anchor of anchors) expect(xml.split(anchor)).toHaveLength(2)
    expect(xml).not.toMatch(/\{\{(?:signature:|autofill_date_signed)|\{[^{}]+\}/)
    // Elected is ballot-box-with-X, unelected is empty — one of each here.
    expect(xml.split('\u2612')).toHaveLength(2)
    expect(xml.split('\u2610')).toHaveLength(2)
    expect(result.masterKey).toBe('ep-lp-trust-couple')
    expect(result.templateId).toBe('engagement-ep-lp-trust-couple')
  })

  it('leaves every optional service unmarked when none is elected', async () => {
    const result = await renderEngagementAgreement(lpInput, { convertDocx: async () => pdf(anchors.join(' ')) })
    const xml = new PizZip(result.docxBytes).file('word/document.xml')!.asText()
    expect(xml.split('\u2610')).toHaveLength(3)
    expect(xml).not.toContain('\u2612')
  })

  it('renders the solo legal-plan letter with one signer and no spouse', async () => {
    const converted = pdf(soloAnchors.join(' '))
    const result = await renderEngagementAgreement(lpSoloInput, { convertDocx: async () => converted })
    const xml = new PizZip(result.docxBytes).file('word/document.xml')!.asText()
    expect(xml).toContain('MetLife')
    expect(xml).toContain('Alex Client')
    for (const anchor of soloAnchors) expect(xml.split(anchor)).toHaveLength(2)
    // Nothing addressed to a second signer, and no leftover spouse text.
    expect(xml).not.toContain('CLIENT_2')
    expect(xml).not.toContain('Jordan Client')
    expect(result.masterKey).toBe('ep-lp-trust-individual')
    expect(result.templateId).toBe('engagement-ep-lp-trust-individual')
  })

  it('offers the solo letter only the services its addendum prints', async () => {
    // Credit shelter planning preserves both spouses' exemptions, so the solo
    // addendum has no such row and electing it is rejected rather than ignored.
    await expect(renderEngagementAgreement(
      { ...lpSoloInput, optionalClauseKeys: ['credit_shelter_planning'] },
      { convertDocx: async () => pdf(soloAnchors.join(' ')) },
    )).rejects.toThrow(/Invalid engagement input.*optionalClauseKeys/)

    const result = await renderEngagementAgreement(
      { ...lpSoloInput, optionalClauseKeys: ['deed_recording'] },
      { convertDocx: async () => pdf(soloAnchors.join(' ')) },
    )
    const xml = new PizZip(result.docxBytes).file('word/document.xml')!.asText()
    expect(xml.split('\u2612')).toHaveLength(2)
    expect(xml).not.toContain('\u2610')
  })

  it.each([
    [{ ...input, practiceArea: 'Probate' as const }],
    [{ ...input, clientMode: 'individual' as const, spouse: null }],
  ])('rejects unavailable template combinations', async (candidate) => {
    await expect(renderEngagementAgreement(candidate, { convertDocx: async () => pdf('') })).rejects.toThrow(/template.*unavailable/i)
  })

  it.each([
    ['a plan on a flat-fee estate plan', { ...input, legalPlan: 'metlife' as const }],
    ['no plan on a plan-funded estate plan', { ...lpInput, legalPlan: null }],
    ['a plan the letter cannot name', { ...lpInput, legalPlan: 'other_legal_plan' }],
    ['an optional service the definition does not offer', { ...lpInput, optionalClauseKeys: ['gift_tax_returns'] }],
  ])('rejects %s', async (_case, candidate) => {
    await expect(renderEngagementAgreement(candidate, { convertDocx: async () => pdf('') })).rejects.toThrow(/Invalid engagement input/i)
  })

  it('still requires the firm fee and payment terms on an agreement that states them', async () => {
    await expect(renderEngagementAgreement(
      { ...input, fee: { amount: 0, paymentTerms: '' } },
      { convertDocx: async () => pdf(anchors.join(' ')) },
    )).rejects.toThrow(/fee\.amount.*fee\.paymentTerms|fee\.paymentTerms/)
  })

  it('rejects a non-Letter PDF', async () => {
    await expect(renderEngagementAgreement(input, { convertDocx: async () => pdf(anchors.join(' '), 595, 842) })).rejects.toThrow(/US Letter/i)
  })

  it.each([
    anchors.slice(1).join(' '),
    [...anchors, anchors[0]].join(' '),
  ])('rejects missing or duplicate anchors', async (text) => {
    await expect(renderEngagementAgreement(input, { convertDocx: async () => pdf(text) })).rejects.toThrow(/anchor/i)
  })
})
