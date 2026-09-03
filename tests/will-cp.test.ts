import fs from 'node:fs'
import path from 'node:path'
import PizZip from 'pizzip'
import { describe, expect, it } from 'vitest'

import { generateNodeEstatePackage } from '@/lib/estateGenerator/node/generate'
import { isNodeEstatePackageSupported } from '@/lib/estateGenerator/node/support'
import { designTargetForMissingField } from '@/lib/estateGenerator/missingFieldDesignMap'
import { DESIGN_SECTION_IDS } from '@/lib/designSheet/sectionIds'
import { bundledTemplateResolver } from '@aubrey-law/drafting-engine/estateGenerator/node/generate'
import { DEFAULT_STYLE_SET } from '@aubrey-law/drafting-engine/styleSets/defaults'

const root = path.join(process.cwd(), 'tools/aubreylaw-docgeneration')

describe('college-prep will (will-cp)', () => {
  it('is a package the node generator supports', () => {
    expect(isNodeEstatePackageSupported('will-cp')).toBe(true)
  })

  it('routes a missing parent to the College Preparation Plan section', () => {
    expect(designTargetForMissingField('will_cp.parent1.full_name')).toMatchObject({
      sectionId: DESIGN_SECTION_IDS.collegePlan,
      targetField: 'college_prep.will_parent1_name',
    })
    // Unknown will_cp.* paths degrade to the section rather than breaking the checklist.
    expect(designTargetForMissingField('will_cp.something_new').sectionId)
      .toBe(DESIGN_SECTION_IDS.collegePlan)
  })
})

describe('college-prep will — rendered document', () => {
  const example = JSON.parse(
    fs.readFileSync(path.join(root, 'examples/client-ma-will-cp.json'), 'utf8'),
  ) as Record<string, unknown>

  const renderText = async (data: Record<string, unknown>) => {
    const result = await generateNodeEstatePackage({
      templateResolver: bundledTemplateResolver,
      styleSet: DEFAULT_STYLE_SET,
      data, packageName: 'will-cp', state: 'MA', root, allowDraft: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.files).toHaveLength(1)
    const xml = new PizZip(result.files[0].buffer).files['word/document.xml'].asText()
    return { xml, text: xml.replace(/<[^>]+>/g, '') }
  }

  it('renders the testator, both parents, and the personal representative succession', async () => {
    const { text } = await renderText(example)

    expect(text).toContain('LAST WILL AND TESTAMENT')
    expect(text).toContain('ROWAN DELGADO')
    expect(text).toContain('to my parents, ALMA DELGADO and MARCUS DELGADO, to be divided equally')
    expect(text).toContain('or to the survivor of them if only one survives me')
    expect(text).toContain('I nominate ALMA DELGADO, as Personal Representative')
    expect(text).toContain('I appoint MARCUS DELGADO as Personal Representative')
  })

  it('leaves no unresolved template syntax or missing-field markers', async () => {
    const { text } = await renderText(example)

    expect(text).not.toMatch(/\{\{|\}\}|\{%|%\}/)
    expect(text).not.toContain('[[ MISSING:')
  })

  it('drops to the single-parent residue clause when only one parent is named', async () => {
    const { text } = await renderText({
      ...example,
      will_cp: { parent1: { full_name: 'Alma Delgado' }, parent2: { full_name: '' } },
    })

    expect(text).toContain('to my parent, ALMA DELGADO, if my parent survives me')
    expect(text).not.toContain('divided equally')
    // The contingent takers survive the branch.
    expect(text).toContain('by right of representation')
  })

  it('keeps the contingent takers and Massachusetts formalities', async () => {
    const { text } = await renderText(example)

    expect(text).toContain('then in equal shares to my then-living siblings')
    expect(text).toContain('Commonwealth of Massachusetts')
    expect(text).toContain('COUNTY OF MIDDLESEX')
    expect(text).toContain('the 14th day of August, 2026')
  })
})
