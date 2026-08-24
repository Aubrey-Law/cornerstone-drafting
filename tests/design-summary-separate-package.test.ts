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
