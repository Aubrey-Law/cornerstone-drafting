import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('single-page facts and attorney notes groups', () => {
  it('keeps intake-derived fields three-up with comparison-based override originals', () => {
    const personal = read('app/admin/drafting/[matterId]/design/sections/PersonalSection.tsx')

    expect(personal).toContain('sectionFieldGrid3')
    expect(personal).toContain("originalValue={original('client_name')}")
    expect(personal).toContain("originalValue={original('marital_status')}")
    expect(personal).toContain("originalValue={original('spouse_name')}")
  })

  it('renders compact child facts with computed ages and the guardian warning', () => {
    const family = read('app/admin/drafting/[matterId]/design/sections/FamilySection.tsx')

    expect(family).toContain('formatAgeLabel(child.dob)')
    expect(family).toContain('Minor — guardian required')
    expect(family).toContain("onChange('children',")
    expect(family).toContain('onAddContact')
    expect(family).toContain('onUpdateContact')
  })

  it('shows the gross estate total in the asset schedule footer', () => {
    const assets = read('app/admin/drafting/[matterId]/design/sections/AssetsSection.tsx')

    expect(assets).toContain('<footer')
    expect(assets).toContain('Gross estate total')
    expect(assets).toContain('totalValue')
    expect(assets).toContain("onChange('assets', next)")
  })

  it('opens the existing intake snapshot from the facts header instead of listing it as a section', () => {
    const page = read('app/admin/drafting/[matterId]/design/DesignSheetPage.tsx')
    const catalog = read('app/admin/drafting/[matterId]/design/designSectionCatalog.tsx')
    const intake = read('app/admin/drafting/[matterId]/design/sections/IntakeSection.tsx')

    expect(page).toContain('View intake snapshot')
    expect(page).toContain('<IntakeSnapshotDialog')
    expect(catalog).toContain("item.id !== DESIGN_SECTION_IDS.intakeReview")
    expect(intake).toContain('<IntakeResyncDialog')
  })

  it('persists all three attorney-note textareas on their existing fields', () => {
    const goals = read('app/admin/drafting/[matterId]/design/sections/GoalsSection.tsx')

    expect(goals).toContain("onChange('goals_notes'")
    expect(goals).toContain("onChange('concerns'")
    expect(goals).toContain("onChange('drafting_notes'")
  })
})
