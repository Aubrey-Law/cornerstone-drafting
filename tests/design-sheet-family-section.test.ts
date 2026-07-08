import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('family information design section', () => {
  const familySource = fs.readFileSync(
    path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/FamilySection.tsx'),
    'utf8',
  )
  const otherBeneficiariesSource = fs.readFileSync(
    path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/OtherBeneficiariesSection.tsx'),
    'utf8',
  )

  it('captures children with gender and deceased status', () => {
    expect(familySource).toContain('title="Children"')
    expect(familySource).toContain('deceased children from previous marriages')
    expect(familySource).toContain('label="Gender"')
    expect(familySource).toContain('label="Deceased"')
    expect(familySource).toContain('Add Child')
  })

  it('exposes children option toggles in Family Information', () => {
    expect(familySource).toContain('title="Children Options"')
    expect(familySource).toContain("onChange('include_child_gender_markers'")
    expect(familySource).toContain("onChange('include_afterborn_children'")
    expect(familySource).toContain("onChange('include_expectant_children'")
    expect(familySource).toContain("onChange('omissions_intentional'")
  })

  it('centralizes disinherited heirs in Family Information', () => {
    expect(familySource).toContain('title="Disinherited Heirs"')
    expect(familySource).toContain('Disinherited Children')
    expect(familySource).toContain('Add Disinherited Heir')
    expect(familySource).toContain("onChange('disinherit_issue'")
    expect(familySource).toContain("onChange('include_general_disinheritance'")
    expect(familySource).toContain('Additional Disinheritance Language')
    expect(familySource).toContain('Clause Library')
    expect(familySource).toContain('Draft with AI')
    expect(otherBeneficiariesSource).not.toContain('Add Disinheritance')
  })
})
