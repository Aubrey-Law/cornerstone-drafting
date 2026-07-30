import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const designRoot = path.join(process.cwd(), 'app/admin/drafting/[matterId]/design')
const read = (relativePath: string) => fs.readFileSync(path.join(designRoot, relativePath), 'utf8')

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
    const plan = read('sections/PlanDesignSection.tsx')
    const trust = read('sections/TrustDetailsSection.tsx')
    const dpoa = read('sections/DpoaProvisionsSection.tsx')
    const healthcare = read('sections/HealthCareDesignSection.tsx')

    expect(plan).toContain('question="Plan type"')
    expect(plan).toContain('question="Will title"')
    expect(trust).toContain('question="Joint or separate trusts?"')
    expect(trust).toContain('question="Residual Beneficiary Method"')
    expect(trust).toContain('question="Include a trust protector?"')
    expect(dpoa).toContain('question="Allow gifts?"')
    expect(healthcare).toContain('question="HIPAA fiduciary scope"')
    expect(healthcare).toContain('question="Life-support preference"')
  })

  it('keeps true multi-select document and power lists as checkboxes', () => {
    const plan = read('sections/PlanDesignSection.tsx')
    const dpoa = read('sections/DpoaProvisionsSection.tsx')

    expect(plan).toContain('<Checkbox')
    expect(dpoa).toContain('<DesignSheetCheckboxOption')
    expect(dpoa).toContain('DPOA_BASIC_POWER_KEYS.map')
  })
})
