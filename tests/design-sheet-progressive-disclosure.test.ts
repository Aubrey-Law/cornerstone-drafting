import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  getAllDesignSectionNavItems,
  getDesignSectionNavItems,
} from '@/lib/designSheet/designSectionNav'
import { DESIGN_SECTION_IDS } from '@/lib/designSheet/sectionIds'
import { designSectionAppliesWhen } from '@/app/admin/drafting/[matterId]/design/designSectionCatalog'
import type { DesignSheet } from '@/types/database'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

const willOnlyInclusions = {
  trust: false,
  will: true,
  dpoa: true,
  healthcare: true,
  deed: false,
  young_adult_estate_plan: false,
  ferpa_release: false,
  spouse_docs: false,
}

describe('design-sheet progressive disclosure', () => {
  it('omits revocable-trust sections for a will-only plan', () => {
    const args = {
      intakeSnapshot: null,
      documentInclusions: willOnlyInclusions,
      planType: 'outright_will',
    }
    const visible = getDesignSectionNavItems(args)
    const all = getAllDesignSectionNavItems(args)

    expect(visible.some(item => item.id === DESIGN_SECTION_IDS.trustDetails)).toBe(false)
    expect(visible.some(item => item.id === DESIGN_SECTION_IDS.assetSchedules)).toBe(false)
    expect(all.find(item => item.id === DESIGN_SECTION_IDS.trustDetails)?.applicable).toBe(false)
    expect(designSectionAppliesWhen(
      DESIGN_SECTION_IDS.trustDetails,
      {
        plan_type: 'outright_will',
        marital_status: 'Single',
        decisions: { document_inclusions: willOnlyInclusions },
      } as unknown as DesignSheet,
    )).toBe(false)
  })

  it('persists the hide-unused toggle and dims revealed inapplicable decisions', () => {
    const page = read('app/admin/drafting/[matterId]/design/DesignSheetPage.tsx')
    // The toggle itself moved into the section index, which is rendered once for
    // both the docked desktop column and the mobile sheet.
    const nav = read('app/admin/drafting/[matterId]/design/DesignSectionNav.tsx')
    const catalog = read('app/admin/drafting/[matterId]/design/designSectionCatalog.tsx')
    const plan = read('app/admin/drafting/[matterId]/design/sections/PlanDesignSection.tsx')

    expect(nav).toContain("Hide what this plan doesn&apos;t use")
    expect(page).toContain('hideUnusedDesignDecisions')
    expect(nav).toContain('decision{hiddenDecisionCount === 1')
    expect(catalog).toContain('appliesWhen?: (sheet: DesignSheet) => boolean')
    expect(catalog).toContain("opacity-45 grayscale-[20%]")
    expect(plan).toContain('<ApplicableDecision')
  })

  it('places signing mechanics in a collapsed optional footer block', () => {
    const page = read('app/admin/drafting/[matterId]/design/DesignSheetPage.tsx')
    const plan = read('app/admin/drafting/[matterId]/design/sections/PlanDesignSection.tsx')
    const signing = read('app/admin/drafting/[matterId]/design/sections/SigningMechanicsSection.tsx')

    expect(page).toContain('<SigningMechanicsSection sheet={sheet} onChange={updateField} />')
    expect(plan).not.toContain('fieldName="signing_county"')
    expect(signing).toContain('useState(false)')
    expect(signing).toContain('Completed at the signing meeting')
    expect(signing).toContain('this never blocks drafting')
  })
})
