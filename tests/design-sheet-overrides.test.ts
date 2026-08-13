import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { INTAKE_PREFILLED_FIELDS } from '@/lib/designSheet/buildInitialSheet'

describe('design sheet prefilled field overrides', () => {
  it('records attorney edits to intake-prefilled fields in sheet.overrides', () => {
    const state = fs.readFileSync(path.join(process.cwd(), 'lib/designSheet/useDesignSheetState.ts'), 'utf8')

    // The set is derived from the registry's prefilled flags — assert the
    // runtime membership rather than source text.
    for (const field of ['client_name', 'city', 'plan_type', 'client_pronouns', 'spouse_pronouns', 'concerns', 'goals_notes']) {
      expect(INTAKE_PREFILLED_FIELDS.has(field)).toBe(true)
    }
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
    expect(personal).toContain("originalValue={original('client_name')}")
    expect(personal).toContain("originalValue={original('city')}")
    expect(personal).toContain("originalValue={original('marital_status')}")
    expect(personal).toContain("originalValue={original('spouse_name')}")
    expect(personal).toContain("originalValue={original('marriage_date')}")
  })
})
