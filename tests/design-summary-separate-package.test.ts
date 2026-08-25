import fs from 'node:fs'
import path from 'node:path'
import PizZip from 'pizzip'
import { describe, expect, it } from 'vitest'
import { generateNodeEstatePackage } from '@/lib/estateGenerator/node/generate'
import { loadNodeEstatePackage } from '@/lib/estateGenerator/node/config'
import { isNodeEstatePackageSupported } from '@/lib/estateGenerator/node/support'
import type { NodeEstateData } from '@/lib/estateGenerator/node/types'

const root = path.join(process.cwd(), 'tools/aubreylaw-docgeneration')

function loadExample(): NodeEstateData {
  return JSON.parse(
    fs.readFileSync(path.join(root, 'examples/client-ma-design-summary-separate.json'), 'utf8'),
  ) as NodeEstateData
}

// `<w:t[^>]*>` would also match `<w:tabs>`, and this worksheet's paragraphs
// carry tab stops — so require the tag to end or be followed by an attribute.
function visibleText(buffer: Buffer): string {
  const xml = new PizZip(buffer).file('word/document.xml')!.asText()
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m => m[1]).join('')
}

async function render(data: NodeEstateData) {
  const result = await generateNodeEstatePackage({
    data,
    packageName: 'design-summary-separate',
    state: 'MA',
    root,
    allowDraft: true,
  })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error)
  return result
}

describe('design-summary-separate package', () => {
  it('is a recognized, loadable Node package that swaps in the interview worksheet', () => {
    expect(isNodeEstatePackageSupported('design-summary-separate')).toBe(true)
    const config = loadNodeEstatePackage('design-summary-separate', root)
    expect(config.documents.map(d => d.template)).toEqual([
      'templates/design-summary-detailed.docx',
      'templates/design-summary-worksheet-separate.docx',
    ])
    for (const document of config.documents) {
      expect(fs.existsSync(path.join(root, document.template))).toBe(true)
    }
  })

  it('renders both documents cleanly for a reciprocal-trust couple', async () => {
    const result = await render(loadExample())

    expect(result.files.map(f => f.name)).toEqual([
      '01-estate-plan-design-summary.docx',
      '02-estate-plan-interview-worksheet.docx',
    ])
    expect(result.missing).toEqual([])
    for (const file of result.files) {
      expect(visibleText(file.buffer)).not.toMatch(/\{\{|\{%|\[\[ MISSING/)
    }
  })

  it('gives each settlor their own trust, trustees, agents and will section', async () => {
    const [, worksheet] = (await render(loadExample())).files
    const text = visibleText(worksheet.buffer)

    expect(text).toContain('TRUST FOR SETTLOR 1')
    expect(text).toContain('TRUST FOR SETTLOR 2')
    expect(text).toContain('The Jordan Coupleton Revocable Trust')
    expect(text).toContain('The Riley Coupleton Revocable Trust')
    expect(text).toContain('POWER OF ATTORNEY (SETTLOR 2)')
    expect(text).toContain('HEALTH CARE PROXY (SETTLOR 2)')
    expect(text).toContain('WILL &amp; EXECUTORS (SETTLOR 2)')
    // The spouse's own trustee set, not the joint one.
    expect(text).toContain('Successor Trustees for Settlor 2')
  })

  it('ticks the boxes the design sheet answered and leaves the rest blank', async () => {
    const [, worksheet] = (await render(loadExample())).files
    const text = visibleText(worksheet.buffer)

    // Answered: trust, DPOA and HIPAA are in; the plan has assets.
    expect(text).toContain('☒ Yes')
    expect(text).toMatch(/Trust:[\s\S]{0,40}☒ Yes/)
    expect(text).toMatch(/Certification of Trust:[\s\S]{0,40}☒ Yes/)
    // Unanswered questions stay an empty pair for the interview.
    expect(text).toMatch(/Table of Contents:[\s\S]{0,40}☐ Yes {3}☐ No/)
    // A design-sheet "no" ticks No rather than leaving both blank.
    expect(text).toMatch(/Require mandatory arbitration for trust disputes:[\s\S]{0,40}☐ Yes {3}☒ No/)
  })

  it('ticks the answers the design sheet already collected but never sent to templates', async () => {
    const [, worksheet] = (await render(loadExample())).files
    const text = visibleText(worksheet.buffer)

    // Citizenship, domicile and the client-facing extras all live on the design
    // sheet; before Phase 0 they stopped at the payload and printed blank.
    expect(text).toMatch(/Citizenship:[\s\S]{0,40}☒ U.S. Citizen/)
    expect(text).toContain('MA')
    expect(text).toMatch(/Estate Plan Signing Guide:[\s\S]{0,40}☒ Yes/)
    expect(text).toMatch(/Successor Trustee Checklist:[\s\S]{0,40}☒ Yes/)
    expect(text).toMatch(/Fiduciary Role Guide:[\s\S]{0,40}☒ Yes/)
    expect(text).toMatch(/Asset Spreadsheet:[\s\S]{0,40}☒ Yes/)
    // Flowchart is off in the example — a stored "no" ticks No, not blank.
    expect(text).toMatch(/Flowchart:[\s\S]{0,40}☐ Yes {3}☒ No/)
    // Will title and signing type now come from their own stored answers.
    expect(text).toMatch(/☒ Pour-Over Will of/)
    expect(text).toMatch(/☒ Attorney supervised/)
    // Asset ownership replaced a hardcoded null.
    expect(text).toContain('Joint (tenants by the entirety)')
    expect(text).toContain('The Jordan Coupleton Revocable Trust')
    // Beneficiaries beyond the family reach a template for the first time.
    expect(text).toContain('Needham Historical Society')
  })

  it('ticks the trust provisions Phase 1 added', async () => {
    const [, worksheet] = (await render(loadExample())).files
    const text = visibleText(worksheet.buffer)

    expect(text).toMatch(/Limit trustee's duty to account:[\s\S]{0,40}☒ Yes/)
    expect(text).toMatch(/Require bond for trustee:[\s\S]{0,40}☐ Yes {3}☒ No/)
    expect(text).toMatch(/Allow a sole acting trustee to appoint co-trustees:[\s\S]{0,40}☒ Yes/)
    expect(text).toMatch(/Include definition of incapacity:[\s\S]{0,40}☒ Yes/)
    // Exactly one option ticks in each incapacity list.
    expect(text).toContain('☒ Two licensed physicians')
    expect(text).toContain('☒ Single licensed physician')
    expect(text).toContain('☒ Assets in table format')
    // Spousal funding already answered "distribution to spouse"; no new field.
    expect(text).toContain('☒ Distribute in trust')
  })

  it('keeps each settlor\u2019s health care wishes and post-death choices separate', async () => {
    const [, worksheet] = (await render(loadExample())).files
    const text = visibleText(worksheet.buffer)
    const settlor1 = text.slice(text.indexOf('HEALTH CARE PROXY (SETTLOR 1)'), text.indexOf('HEALTH CARE PROXY (SETTLOR 2)'))
    const settlor2 = text.slice(text.indexOf('HEALTH CARE PROXY (SETTLOR 2)'), text.indexOf('HEALTHCARE FORMS'))

    // The example gives the two settlors deliberately different answers, so a
    // block wired to the wrong party would show up as both halves matching.
    expect(settlor1).toMatch(/Wish to die at home:[\s\S]{0,40}☒ Yes/)
    expect(settlor2).toMatch(/Wish to die at home:[\s\S]{0,40}☐ Yes {3}☒ No/)
    expect(settlor1).toContain('☒ First-named agent has final authority')
    expect(settlor2).toContain('☒ Majority rules')
    expect(settlor1).toContain('Please play music I know.')
    expect(settlor2).toContain('Defer to my spouse.')

    // Post-death choices, likewise per settlor.
    expect(text).toContain('☒ Cremation')
    expect(text).toContain('☒ Burial')
    expect(text).toContain('Ashes scattered at Crane Beach.')
    expect(text).toContain('Buried beside my parents.')
  })

  it('omits every Settlor 2 block for an unmarried client', async () => {
    const data = loadExample() as unknown as Record<string, unknown>
    delete data.spouse
    const [, worksheet] = (await render(data as unknown as NodeEstateData)).files
    const text = visibleText(worksheet.buffer)

    expect(text).toContain('TRUST FOR SETTLOR 1')
    expect(text).not.toContain('TRUST FOR SETTLOR 2')
    expect(text).not.toContain('POWER OF ATTORNEY (SETTLOR 2)')
    expect(text).not.toContain('HEALTH CARE PROXY (SETTLOR 2)')
    expect(text).not.toContain('Settlor 2 Information')
    expect(text).not.toMatch(/\{\{|\{%|\[\[ MISSING/)
  })
})
