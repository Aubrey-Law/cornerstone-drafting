import fs from 'node:fs'
import path from 'node:path'
import PizZip from 'pizzip'
import { describe, expect, it } from 'vitest'
import { generateNodeEstatePackage } from '@/lib/estateGenerator/node/generate'
import { loadNodeEstatePackage } from '@/lib/estateGenerator/node/config'
import { isNodeEstatePackageSupported } from '@/lib/estateGenerator/node/support'
import type { NodeEstateData } from '@/lib/estateGenerator/node/types'
import { bundledTemplateResolver } from '@aubrey-law/drafting-engine/estateGenerator/node/generate'
import { DEFAULT_STYLE_SET } from '@aubrey-law/drafting-engine/styleSets/defaults'

const root = path.join(process.cwd(), 'tools/aubreylaw-docgeneration')

function loadExample(): NodeEstateData {
  return JSON.parse(
    fs.readFileSync(path.join(root, 'examples/client-ma-design-summary.json'), 'utf8'),
  ) as NodeEstateData
}

function visibleText(buffer: Buffer): string {
  const xml = new PizZip(buffer).file('word/document.xml')!.asText()
  return [...xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(m => m[1]).join('')
}

describe('design-summary package', () => {
  it('is a recognized, loadable Node package with two documents', () => {
    expect(isNodeEstatePackageSupported('design-summary')).toBe(true)
    const config = loadNodeEstatePackage('design-summary', root)
    expect(config.name).toBe('design-summary')
    expect(config.documents.map(d => d.template)).toEqual([
      'templates/design-summary-detailed.docx',
      'templates/design-summary-worksheet.docx',
    ])
    for (const document of config.documents) {
      expect(fs.existsSync(path.join(root, document.template))).toBe(true)
    }
  })

  it('renders both summaries with no missing fields or unresolved markers (married + trust)', async () => {
    const result = await generateNodeEstatePackage({
      data: loadExample(),
      packageName: 'design-summary',
      state: 'MA',
      root,
      allowDraft: true,
      templateResolver: bundledTemplateResolver,
      styleSet: DEFAULT_STYLE_SET,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.files.map(f => f.name)).toEqual([
      '01-estate-plan-design-summary.docx',
      '02-estate-plan-design-worksheet.docx',
    ])
    expect(result.missing).toEqual([])
    for (const file of result.files) {
      const text = visibleText(file.buffer)
      expect(text).not.toMatch(/\{\{|\{%|\[\[ MISSING/)
      expect(text).toContain('Jordan Coupleton')
      expect(text).toContain('Riley Coupleton')
    }
    const worksheet = visibleText(result.files[1].buffer)
    expect(worksheet).toContain('Riley Former')
    expect(worksheet).toContain('June 15, 2001')
    expect(worksheet).toContain('02118')
    expect(worksheet).toContain('$1,000,000')
    expect(worksheet).toContain('Descendants, per stirpes')
  })

  it('omits spouse, trust, and guardian sections for a single will-only client', async () => {
    const data: NodeEstateData = {
      client: { full_name: 'Taylor Solo', date_of_birth: 'May 5, 1980', street_address: '9 Pine Rd', county: 'Middlesex', state: 'MA' },
      children: [],
      planning: { include_simple_will: true, include_dpoa: true, include_hcp: true, include_hipaa: true },
      fiduciaries: { agent: { primary: { full_name: 'Dana Buddy' } } },
      healthcare: { agent: { primary: { full_name: 'Dana Buddy' } } },
      execution: {},
    } as unknown as NodeEstateData

    const result = await generateNodeEstatePackage({
      data,
      packageName: 'design-summary',
      state: 'MA',
      root,
      allowDraft: true,
      templateResolver: bundledTemplateResolver,
      styleSet: DEFAULT_STYLE_SET,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    for (const file of result.files) {
      const text = visibleText(file.buffer)
      expect(text).not.toMatch(/\{\{|\{%/)
      expect(text).toContain('Taylor Solo')
      expect(text).not.toContain('Your Revocable Living Trust')
      expect(text).not.toContain('Your Spouse')
    }
  })
})
