import { createHash } from 'node:crypto'
import PizZip from 'pizzip'
import { describe, expect, it } from 'vitest'
import { renderEngagementAgreement } from '@/lib/engagement/render'
import { allEngagementAnchorMarkers } from '@/lib/engagement/anchors'

const anchors = allEngagementAnchorMarkers(2)

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
  optionalClauseKeys: [], emailMessage: '', expirationHours: 72,
}

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

  it.each([
    [{ ...input, practiceArea: 'Probate' as const }],
    [{ ...input, clientMode: 'individual' as const, spouse: null }],
    [{ ...input, practiceArea: 'EP-LP' as const, legalPlan: 'MetLife' as const }],
  ])('rejects unavailable template combinations', async (candidate) => {
    await expect(renderEngagementAgreement(candidate, { convertDocx: async () => pdf('') })).rejects.toThrow(/template.*unavailable/i)
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
