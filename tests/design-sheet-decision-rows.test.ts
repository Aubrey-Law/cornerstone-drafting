import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const designRoot = path.join(process.cwd(), 'app/admin/drafting/[matterId]/design')
const read = (relativePath: string) => fs.readFileSync(path.join(designRoot, relativePath), 'utf8')

/** Every section file at once, for assertions about presence rather than placement. */
const readSections = () => {
  const dir = path.join(designRoot, 'sections')
  return fs
    .readdirSync(dir)
    .filter(name => name.endsWith('.tsx'))
    .map(name => fs.readFileSync(path.join(dir, name), 'utf8'))
    .join('\n')
}

describe('single-page design decision primitives', () => {
  it('provides controlled GroupCard and keyboard-operable DecisionRow primitives', () => {
    const shared = read('sections/shared.tsx')

    expect(shared).toContain('export function GroupCard')
    expect(shared).toContain("md:grid-cols-[232px_minmax(0,1fr)]")
    expect(shared).toContain('aria-pressed={selected}')
    expect(shared).toContain('Blocks drafting')
    expect(shared).toContain('GroupCardContext.Provider')
  })

  it('uses GroupCard as the single-page outer chrome', () => {
    const page = read('DesignSheetPage.tsx')

    expect(page).toContain('<GroupCard')
    expect(page).not.toContain('className="mb-4 overflow-hidden rounded-xl border')
  })

  it('renders the requested exclusive choices as DecisionRows', () => {
    // What matters is that each of these is a DecisionRow rather than a
    // checkbox — `question=` is the prop only DecisionRow takes. Which section
    // renders it is a layout decision that has already moved once ("Will title"
    // from PlanDesignSection to FamilySection), so this searches every section
    // rather than failing on a file move that changed nothing for the user.
    const sections = readSections()

    for (const question of [
      'Plan type',
      'Will title',
      'Joint or separate trusts?',
      'Residual Beneficiary Method',
      'Include a trust protector?',
      'Allow gifts?',
      'HIPAA fiduciary scope',
      'Life-support preference',
    ]) {
      expect(sections, question).toContain(`question="${question}"`)
    }
  })

  it('keeps true multi-select document and power lists as checkboxes', () => {
    const plan = read('sections/PlanDesignSection.tsx')
    const dpoa = read('sections/DpoaProvisionsSection.tsx')

    expect(plan).toContain('<Checkbox')
    expect(dpoa).toContain('<DesignSheetCheckboxOption')
    expect(dpoa).toContain('DPOA_BASIC_POWER_KEYS.map')
  })
})

describe('questions that were rendered but unreachable', () => {
  it('asks about psychotherapy notes from the section that is actually rendered', () => {
    const sections = readSections()
    const will = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/WillProvisionsSection.tsx'),
      'utf8',
    )
    const healthcare = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/HealthCareDesignSection.tsx'),
      'utf8',
    )

    // It lived behind a `healthcare` scope in WillProvisionsSection, which is
    // only ever rendered with scope="will" — so it could not be answered.
    expect(sections).toContain('fieldName="hipaa_psychotherapy_notes"')
    expect(will).not.toContain('hipaa_psychotherapy_notes')
    expect(healthcare).toContain('fieldName="hipaa_psychotherapy_notes"')
  })
})
