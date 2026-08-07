import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

const SECTIONS_DIR = path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections')

/**
 * Every section file at once.
 *
 * Which section renders a given group is a layout decision that has already
 * changed more than once — the child facts moved from FamilySection to
 * PersonalSection, and the plan-structure lists to PlanStructureFactsSection.
 * These assertions care that the group is still rendered, not where, so pinning
 * a filename only produced failures that named no real regression.
 */
const readSections = () =>
  fs
    .readdirSync(SECTIONS_DIR)
    .filter(name => name.endsWith('.tsx'))
    .map(name => fs.readFileSync(path.join(SECTIONS_DIR, name), 'utf8'))
    .join('\n')

describe('single-page facts and attorney notes groups', () => {
  it('keeps intake-derived fields three-up with comparison-based override originals', () => {
    const personal = read('app/admin/drafting/[matterId]/design/sections/PersonalSection.tsx')

    expect(personal).toContain('sectionFieldGrid3')
    expect(personal).toContain("originalValue={original('client_name')}")
    expect(personal).toContain("originalValue={original('marital_status')}")
    expect(personal).toContain("originalValue={original('spouse_name')}")
  })

  it('renders compact child facts with computed ages and the guardian warning', () => {
    const sections = readSections()

    expect(sections).toContain('formatAgeLabel(child.dob)')
    // The static "Minor — guardian required" label was replaced in #203 by
    // minor status derived from the date of birth, with an explicit override.
    // Assert the mechanism that replaced it rather than the copy that went.
    expect(sections).toContain('isMinorFromDob(child.dob)')
    expect(sections).toContain('Treat as minor')
    expect(sections).toContain("onChange('children',")
    expect(sections).toContain('onAddContact')
    expect(sections).toContain('onUpdateContact')
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
