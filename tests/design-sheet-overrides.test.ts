import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('design sheet prefilled field overrides', () => {
  it('records attorney edits to intake-prefilled fields in sheet.overrides', () => {
    const initial = fs.readFileSync(path.join(process.cwd(), 'lib/designSheet/buildInitialSheet.ts'), 'utf8')
    const state = fs.readFileSync(path.join(process.cwd(), 'lib/designSheet/useDesignSheetState.ts'), 'utf8')

    expect(initial).toContain("'client_name'")
    expect(initial).toContain("'city'")
    expect(initial).toContain("'plan_type'")
    expect(state).toContain('INTAKE_PREFILLED_FIELDS')
    expect(state).toContain('const existing = previousOverrides[fieldName]')
    expect(state).toContain('const original = existing?.original ?? normalizeOverrideValue(prev[field])')
    expect(state).toContain('if (updated === original)')
    expect(state).toContain("updated_by: existing?.updated_by ?? 'attorney'")
  })

  it('renders overridden prefilled fields with the attorney override color and visible prefilled value', () => {
    const shared = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/shared.tsx'), 'utf8')

    expect(shared).toContain("isOverride ? 'bg-warning/10 border-warning/40")
    expect(shared).toContain('function PrefilledValueNote')
    expect(shared).toContain('Prefilled: {displayOriginalValue(originalValue)}')
    expect(shared).toContain('function OverrideIndicator')
    expect(shared).toContain('Attorney override')
  })

  it('passes override originals into common prefilled fields', () => {
    const personal = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/PersonalSection.tsx'), 'utf8')
    const family = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/FamilySection.tsx'), 'utf8')

    expect(personal).toContain("originalValue={original('client_name')}")
    expect(personal).toContain("originalValue={original('city')}")
    expect(personal).toContain("originalValue={original('marital_status')}")
    expect(family).toContain("originalValue={original('spouse_name')}")
    expect(family).toContain("originalValue={original('marriage_date')}")
  })
})
